import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { BenefitGrantService } from "../../../services/payment/BenefitGrantService.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import { APPLE_PROVIDER } from "./AppleIapConstants.js";
import { isAppleIapConfigured, loadAppleIapConfig } from "./AppleIapConfig.js";
import { AppleIapConfigError, AppleIapVerifyError } from "./AppleIapErrors.js";
import { fetchTransactionInfo } from "./AppleIapClient.js";
import {
  type AppleServerNotificationPayload,
  decodeTransactionPayload,
} from "./AppleIapMapper.js";
import {
  createAppleServerToken,
  hashSignedPayload,
  verifyAndDecodeAppleJws,
} from "./AppleIapJws.js";

export interface VerifyAppleIapTransactionResult {
  environment: "production" | "sandbox";
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  sourceOrderId: string;
  alreadyApplied: boolean;
}

export class AppleIapService {
  constructor(
    private readonly benefitGrantService: BenefitGrantService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly paymentEventRepository: PaymentEventRepository
  ) {}

  isConfigured(): boolean {
    return isAppleIapConfigured();
  }

  async verifyProMonthlyTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<VerifyAppleIapTransactionResult> {
    const config = loadAppleIapConfig();

    const token = createAppleServerToken({
      issuerId: config.issuerId,
      keyId: config.keyId,
      bundleId: config.bundleId,
      privateKeyPem: config.privateKeyPem,
    });

    const transaction = await fetchTransactionInfo(input.transactionId, token, config.rootCaPem);

    if (transaction.bundleId !== config.bundleId) {
      throw new AppleIapVerifyError("Bundle id mismatch");
    }

    if (transaction.productId !== config.proProductId) {
      throw new AppleIapVerifyError("Product id mismatch");
    }

    const originalTransactionId = transaction.originalTransactionId || transaction.transactionId;
    if (!originalTransactionId) {
      throw new AppleIapVerifyError("Missing originalTransactionId");
    }

    const sourceOrderId = `apple_iap:${originalTransactionId}`;
    let alreadyApplied = false;
    try {
      const result = await this.paymentEntitlementService.grantAfterPayment({
        userId: input.userId,
        sourceOrderId,
        productCode: "pro_monthly",
        channel: "ios_iap",
      });
      alreadyApplied = result.alreadyApplied;
    } catch (_error) {
      const queued = await this.benefitGrantService.enqueueGrant({
        userId: input.userId,
        sourceOrderId,
        productCode: "pro_monthly",
        channel: "ios_iap",
        payload: { fallbackReason: "sync_grant_failed", source: "apple_verify_transaction" },
      });
      alreadyApplied = !queued.created;
    }

    return {
      environment: transaction.environment,
      transactionId: transaction.transactionId,
      originalTransactionId,
      productId: transaction.productId,
      sourceOrderId,
      alreadyApplied,
    };
  }

  async handleServerNotification(input: { signedPayload: string }): Promise<{
    status: "success" | "ignored";
    eventId: string;
    eventType: string;
  }> {
    const config = loadAppleIapConfig();

    const signedPayload = input.signedPayload?.trim();
    if (!signedPayload) {
      throw new AppleIapVerifyError("signedPayload is required");
    }

    const decoded = verifyAndDecodeAppleJws(signedPayload, config.rootCaPem);
    const notification = decoded.payload as AppleServerNotificationPayload;
    const eventId = String(notification.notificationUUID ?? "").trim() || hashSignedPayload(signedPayload);
    const eventType = [
      String(notification.notificationType ?? "").trim() || "UNKNOWN",
      String(notification.subtype ?? "").trim(),
    ]
      .filter(Boolean)
      .join(".");

    const existing = await this.paymentEventRepository.findByProviderEventId({
      provider: APPLE_PROVIDER,
      providerEventId: eventId,
      eventType: eventType,
    });
    
    if (existing && existing.status !== "received") {
      return { status: "ignored", eventId, eventType };
    }

    const event =
      existing ??
      (await this.paymentEventRepository.create({
        provider: APPLE_PROVIDER,
        providerEventId: eventId,
        providerOrderId: null,
        eventType,
        rawPayload: {
          notification,
          header: decoded.header,
        },
      }));

    try {
      const signedTransactionInfo = notification.data?.signedTransactionInfo?.trim();
      if (signedTransactionInfo) {
        const txDecoded = verifyAndDecodeAppleJws(signedTransactionInfo, config.rootCaPem);
        const tx = decodeTransactionPayload(txDecoded.payload);
        if (tx.bundleId !== config.bundleId) {
          await this.paymentEventRepository.markIgnored(event.id, "Bundle id mismatch");
          return { status: "ignored", eventId, eventType };
        }
      }

      // V1 骨架：先做签名验证 + 幂等落库。
      // 续订/退款/撤销等自动权益同步在下一步按事件类型补全。
      await this.paymentEventRepository.markProcessed(event.id);
      return { status: "success", eventId, eventType };
    } catch (error) {
      await this.paymentEventRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}
