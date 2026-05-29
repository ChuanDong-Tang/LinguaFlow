import { createHash } from "node:crypto";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { AppleIapAccountLinkRepository } from "@lf/core/ports/repository/AppleIapAccountLinkRepository.js";
import type { PaymentOrderStatus } from "@lf/core/ports/payment/PaymentTypes.js";
import type { BenefitGrantService } from "../../../services/payment/BenefitGrantService.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import type { AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import { getExpectedCurrentStatusesForNextStatus } from "../../../services/payment/PaymentOrderStateMachine.js";
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
    private readonly paymentEventRepository: PaymentEventRepository,
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly autoRenewService?: AutoRenewService,
    private readonly appleIapAccountLinkRepository?: AppleIapAccountLinkRepository
  ) {}

  isConfigured(): boolean {
    return isAppleIapConfigured();
  }

  async registerAppAccountToken(input: {
    userId: string;
    appAccountToken: string;
  }): Promise<{ appAccountToken: string }> {
    if (!this.appleIapAccountLinkRepository) {
      throw new Error("APPLE_IAP_ACCOUNT_LINK_REPOSITORY_NOT_CONFIGURED");
    }
    const expectedAppAccountToken = createAppleAppAccountToken(input.userId);
    if (!sameAppleAppAccountToken(input.appAccountToken, expectedAppAccountToken)) {
      throw new AppleIapVerifyError("appAccountToken mismatch");
    }
    await this.appleIapAccountLinkRepository.upsert({
      userId: input.userId,
      appAccountToken: expectedAppAccountToken,
    });
    return { appAccountToken: expectedAppAccountToken };
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

    const expectedAppAccountToken = createAppleAppAccountToken(input.userId);
    if (!transaction.appAccountToken) {
      throw new AppleIapVerifyError("Missing appAccountToken");
    }
    if (!sameAppleAppAccountToken(transaction.appAccountToken, expectedAppAccountToken)) {
      throw new AppleIapVerifyError("appAccountToken mismatch");
    }

    const originalTransactionId = transaction.originalTransactionId || transaction.transactionId;
    if (!originalTransactionId) {
      throw new AppleIapVerifyError("Missing originalTransactionId");
    }

    const sourceOrderId = `apple_iap:${transaction.transactionId}`;
    await this.appleIapAccountLinkRepository?.upsert({
      userId: input.userId,
      appAccountToken: expectedAppAccountToken,
      originalTransactionId,
      latestTransactionId: transaction.transactionId,
    });
    await this.autoRenewService?.register({
      userId: input.userId,
      provider: "apple",
      providerAgreementId: originalTransactionId,
      latestTransactionId: transaction.transactionId,
      currentPeriodStart: transaction.purchaseDate ? new Date(transaction.purchaseDate) : null,
      currentPeriodEnd: transaction.expiresDate ? new Date(transaction.expiresDate) : null,
      nextPeriodEnd: transaction.expiresDate ? new Date(transaction.expiresDate) : null,
      metadata: {
        source: "apple_verify_transaction",
        environment: transaction.environment,
        productId: transaction.productId,
        appAccountToken: transaction.appAccountToken,
      },
    });
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
    
    if (existing && !["received", "failed"].includes(existing.status)) {
      return { status: "ignored", eventId, eventType };
    }

    const event =
      existing ??
      (await this.paymentEventRepository.findOrCreate({
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
      let tx: ReturnType<typeof decodeTransactionPayload> | null = null;
      const signedTransactionInfo = notification.data?.signedTransactionInfo?.trim();
      if (signedTransactionInfo) {
        const txDecoded = verifyAndDecodeAppleJws(signedTransactionInfo, config.rootCaPem);
        tx = decodeTransactionPayload(txDecoded.payload);
        assertAppleNotificationEnvironmentMatchesTransaction({
          notificationEnvironment: notification.data?.environment,
          transactionEnvironment: tx.signedEnvironment,
        });
        if (tx.bundleId !== config.bundleId) {
          await this.paymentEventRepository.markIgnored(event.id, "Bundle id mismatch");
          return { status: "ignored", eventId, eventType };
        }

        if (this.autoRenewService && tx.productId === config.proProductId && tx.originalTransactionId) {
          const periodStart = tx.purchaseDate ? new Date(tx.purchaseDate) : null;
          const periodEnd = tx.expiresDate ? new Date(tx.expiresDate) : null;
          if (isApplePaidRenewal(notification.notificationType)) {
            // Apple 自动续订由 Apple 扣款；服务端收到 DID_RENEW 等通知后再补发本期权益。
            const result = await this.autoRenewService.handleApplePaidTransaction({
              originalTransactionId: tx.originalTransactionId,
              transactionId: tx.transactionId,
              periodStart,
              periodEnd,
              rawPayload: {
                notification,
                transaction: tx,
              },
            });
            if (result.status === "ignored" && !result.userId && tx.appAccountToken) {
              await this.handleApplePaidTransactionByAppAccountToken({
                appAccountToken: tx.appAccountToken,
                originalTransactionId: tx.originalTransactionId,
                transactionId: tx.transactionId,
                periodStart,
                periodEnd,
                rawPayload: {
                  notification,
                  transaction: tx,
                },
              });
            }
          } else if (["EXPIRED", "REFUND", "REVOKE"].includes(String(notification.notificationType ?? "").toUpperCase())) {
            await this.autoRenewService.handleAppleCancelled({
              originalTransactionId: tx.originalTransactionId,
              rawPayload: { notification, transaction: tx },
            });
          }
        }

        const nextStatus =
          tx.productId === config.proProductId
            ? mapAppleEventToOrderStatus(notification.notificationType)
            : null;
        if (nextStatus) {
          const candidateProviderOrderIds = [
            tx.originalTransactionId,
            tx.transactionId,
            `apple_iap:${tx.originalTransactionId}`,
          ].filter((value): value is string => Boolean(value));
          const order = await this.findOrderByProviderOrderIds(candidateProviderOrderIds);
          if (order) {
            await this.paymentOrderRepository.updateStatus({
              id: order.id,
              status: nextStatus,
              expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus(nextStatus),
              metadata: {
                ...(typeof order.metadata === "object" && order.metadata ? order.metadata : {}),
                appleIap: {
                  eventType: notification.notificationType ?? null,
                  subtype: notification.subtype ?? null,
                  transactionId: tx.transactionId ?? null,
                  originalTransactionId: tx.originalTransactionId ?? null,
                },
              },
            });
          }
        }
      }

      // Apple 回调在本阶段先统一完成：幂等 + 状态前置迁移 + 事件落态。
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

  private async findOrderByProviderOrderIds(ids: string[]): Promise<Awaited<ReturnType<PaymentOrderRepository["findByProviderOrderId"]>> | null> {
    for (const providerOrderId of ids) {
      const order = await this.paymentOrderRepository.findByProviderOrderId(providerOrderId);
      if (order) return order;
    }
    return null;
  }

  private async handleApplePaidTransactionByAppAccountToken(input: {
    appAccountToken: string;
    originalTransactionId: string;
    transactionId: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    rawPayload: unknown;
  }): Promise<void> {
    if (!this.autoRenewService || !this.appleIapAccountLinkRepository) return;
    const link = await this.appleIapAccountLinkRepository.findByAppAccountToken(input.appAccountToken);
    if (!link) return;

    await this.appleIapAccountLinkRepository.upsert({
      appAccountToken: input.appAccountToken,
      userId: link.userId,
      originalTransactionId: input.originalTransactionId,
      latestTransactionId: input.transactionId,
    });
    await this.autoRenewService.register({
      userId: link.userId,
      provider: "apple",
      providerAgreementId: input.originalTransactionId,
      latestTransactionId: input.transactionId,
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: input.periodEnd,
      nextPeriodEnd: input.periodEnd,
      metadata: {
        source: "apple_server_notification_app_account_token",
        appAccountToken: input.appAccountToken,
      },
    });
    await this.autoRenewService.handleApplePaidTransaction({
      originalTransactionId: input.originalTransactionId,
      transactionId: input.transactionId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      rawPayload: input.rawPayload,
    });
  }
}

function isApplePaidRenewal(notificationType: string | undefined): boolean {
  const type = String(notificationType ?? "").toUpperCase();
  return ["SUBSCRIBED", "DID_RENEW", "DID_RECOVER", "ONE_TIME_CHARGE"].includes(type);
}

function createAppleAppAccountToken(userId: string): string {
  const hash = createHash("sha256").update(`oio:${userId}`).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") +
      hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}

function sameAppleAppAccountToken(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function assertAppleNotificationEnvironmentMatchesTransaction(input: {
  notificationEnvironment?: string;
  transactionEnvironment: string | null;
}): void {
  if (!input.notificationEnvironment || !input.transactionEnvironment) return;
  const notificationEnvironment = input.notificationEnvironment.trim().toLowerCase();
  const transactionEnvironment = input.transactionEnvironment.trim().toLowerCase();
  if (notificationEnvironment !== transactionEnvironment) {
    throw new AppleIapVerifyError("Apple notification environment mismatch");
  }
}

function mapAppleEventToOrderStatus(
  notificationType: string | undefined
): PaymentOrderStatus | null {
  const type = String(notificationType ?? "").toUpperCase();
  if (["SUBSCRIBED", "DID_RENEW", "DID_RECOVER", "ONE_TIME_CHARGE"].includes(type)) {
    return "paid";
  }
  if (["REFUND", "REVOKE"].includes(type)) {
    return "refunded";
  }
  if (["DID_FAIL_TO_RENEW", "GRACE_PERIOD_EXPIRED"].includes(type)) {
    return "failed";
  }
  if (["EXPIRED"].includes(type)) {
    return "closed";
  }
  return null;
}
