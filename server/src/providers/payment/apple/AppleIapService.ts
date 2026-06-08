import { createHash } from "node:crypto";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { AppleIapAccountLinkRepository } from "@lf/core/ports/repository/AppleIapAccountLinkRepository.js";
import type { PaymentOrderStatus } from "@lf/core/ports/payment/PaymentTypes.js";
import type { BenefitGrantService } from "../../../services/payment/BenefitGrantService.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import type { AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import { ProRenewalTooEarlyError } from "../../../services/payment/ProPrepaidLimit.js";
import { createEntitlementGrantPayload } from "../../../services/payment/EntitlementGrantSnapshot.js";
import { getExpectedCurrentStatusesForNextStatus } from "../../../services/payment/PaymentOrderStateMachine.js";
import { APPLE_PROVIDER } from "./AppleIapConstants.js";
import { isAppleIapConfigured, loadAppleIapConfig } from "./AppleIapConfig.js";
import {
  AppleIapConfigError,
  AppleIapSubscriptionAlreadyBoundError,
  AppleIapVerifyError,
} from "./AppleIapErrors.js";
import { fetchTransactionInfo } from "./AppleIapClient.js";
import {
  type AppleServerNotificationPayload,
  decodeTransactionPayload,
} from "./AppleIapMapper.js";
import {
  createAppleServerTokenWithDiagnostics,
  hashSignedPayload,
  verifyAndDecodeAppleJws,
} from "./AppleIapJws.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";

export interface VerifyAppleIapTransactionResult {
  environment: "production" | "sandbox";
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  purchaseKind: "single_purchase" | "auto_renew";
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
    return getRuntimeConfig().payment.appleIap.enabled && isAppleIapConfigured();
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

    const { token, diagnostics: serverTokenDiagnostics } = createAppleServerTokenWithDiagnostics({
      issuerId: config.issuerId,
      keyId: config.keyId,
      bundleId: config.bundleId,
      privateKeyPem: config.privateKeyPem,
    });

    let transaction: Awaited<ReturnType<typeof fetchTransactionInfo>>;
    try {
      transaction = await fetchTransactionInfo(input.transactionId, token, config.rootCaPem);
    } catch (error) {
      if (error instanceof AppleIapVerifyError) {
        throw error.withDetails({
          ...(error.details ?? {}),
          serverToken: serverTokenDiagnostics,
        });
      }
      throw error;
    }

    if (transaction.bundleId !== config.bundleId) {
      throw new AppleIapVerifyError("Bundle id mismatch", "APPLE_BUNDLE_ID_MISMATCH", {
        expectedBundleId: config.bundleId,
        actualBundleId: transaction.bundleId,
        environment: transaction.environment,
      });
    }

    const purchaseKind = resolveApplePurchaseKind(transaction.productId, config);
    if (!purchaseKind) {
      throw new AppleIapVerifyError("Product id mismatch", "APPLE_PRODUCT_ID_MISMATCH", {
        expectedProductIds: [
          config.proProductId,
          config.proMonthlyOneTimeProductId,
        ].filter(Boolean),
        actualProductId: transaction.productId,
        environment: transaction.environment,
      });
    }

    const expectedAppAccountToken = createAppleAppAccountToken(input.userId);
    if (!transaction.appAccountToken) {
      throw new AppleIapVerifyError("Missing appAccountToken", "APPLE_APP_ACCOUNT_TOKEN_MISSING", {
        environment: transaction.environment,
        transactionId: transaction.transactionId,
      });
    }
    if (!sameAppleAppAccountToken(transaction.appAccountToken, expectedAppAccountToken)) {
      throw new AppleIapVerifyError("appAccountToken mismatch", "APPLE_APP_ACCOUNT_TOKEN_MISMATCH", {
        environment: transaction.environment,
        transactionId: transaction.transactionId,
      });
    }

    const originalTransactionId = transaction.originalTransactionId || transaction.transactionId;
    if (!originalTransactionId) {
      throw new AppleIapVerifyError("Missing originalTransactionId", "APPLE_ORIGINAL_TRANSACTION_ID_MISSING", {
        environment: transaction.environment,
        transactionId: transaction.transactionId,
      });
    }

    const grantMode = purchaseKind === "auto_renew" ? "subscription_period" : "fixed_duration";
    const grantPeriodStart =
      purchaseKind === "auto_renew" && transaction.purchaseDate
        ? new Date(transaction.purchaseDate)
        : null;
    const grantPeriodEnd =
      purchaseKind === "auto_renew" && transaction.expiresDate
        ? new Date(transaction.expiresDate)
        : null;
    const prepaidLimit = purchaseKind === "single_purchase" ? "enforce" : "skip";

    const existingOrder = await this.paymentOrderRepository.findByProviderOrderId(transaction.transactionId);
    if (existingOrder && existingOrder.userId !== input.userId) {
      throw new AppleIapSubscriptionAlreadyBoundError({ originalTransactionId });
    }

    let isExistingAppleSubscription = false;
    let shouldTransferAppleSubscription = false;
    if (purchaseKind === "auto_renew") {
      const now = new Date();
      if (!grantPeriodEnd || grantPeriodEnd <= now) {
        throw new AppleIapVerifyError("Apple subscription is expired", "APPLE_SUBSCRIPTION_EXPIRED", {
          environment: transaction.environment,
          transactionId: transaction.transactionId,
          originalTransactionId,
          expiresDate: transaction.expiresDate,
        });
      }

      const existingByOriginal =
        await this.appleIapAccountLinkRepository?.findByOriginalTransactionId(originalTransactionId);
      const existingAutoRenew =
        await this.autoRenewService?.getAppleSubscriptionByOriginalTransactionId(originalTransactionId);
      const boundUserId =
        existingByOriginal?.userId !== input.userId
          ? existingByOriginal?.userId
          : existingAutoRenew?.userId !== input.userId
            ? existingAutoRenew?.userId
            : null;

      if (boundUserId) {
        // 这次 Apple 交易的 appAccountToken 已经校验为当前 OIO 账号，
        // 且 expiresDate 仍有效；这里信 Apple 当前交易，允许从旧 OIO 账号转绑。
        // 旧账号本地仍是 Pro/旧 auto-renew 周期未及时同步，不能再阻断当前账号发权益。
        shouldTransferAppleSubscription = Boolean(existingAutoRenew && existingAutoRenew.userId !== input.userId);
      }

      isExistingAppleSubscription =
        existingByOriginal?.userId === input.userId || existingAutoRenew?.userId === input.userId;
    }

    if (!existingOrder && !isExistingAppleSubscription) {
      // 新开 Apple 购买/订阅才检查 active Pro；同一 originalTransactionId 的续费/restore 允许继续幂等处理。
      await this.paymentEntitlementService.assertCanStartNewProPurchase(input.userId);
    }

    if (purchaseKind === "auto_renew") {
      try {
        await this.appleIapAccountLinkRepository?.claimOriginalTransaction({
          userId: input.userId,
          appAccountToken: expectedAppAccountToken,
          originalTransactionId,
          latestTransactionId: transaction.transactionId,
        });
      } catch (error) {
        if (isAppleSubscriptionBoundRepositoryError(error)) {
          throw new AppleIapSubscriptionAlreadyBoundError({ originalTransactionId });
        }
        throw error;
      }
      const autoRenewMetadata = {
        source: shouldTransferAppleSubscription
          ? "apple_verify_transaction_transfer"
          : "apple_verify_transaction",
        environment: transaction.environment,
        productId: transaction.productId,
        appAccountToken: transaction.appAccountToken,
      };
      if (shouldTransferAppleSubscription) {
        const existingAutoRenew =
          await this.autoRenewService?.getAppleSubscriptionByOriginalTransactionId(originalTransactionId);
        if (existingAutoRenew) {
          await this.autoRenewService?.transferAppleSubscriptionToUser({
            subscriptionId: existingAutoRenew.id,
            userId: input.userId,
            latestTransactionId: transaction.transactionId,
            periodStart: grantPeriodStart,
            periodEnd: grantPeriodEnd,
            metadata: autoRenewMetadata,
          });
        }
      } else {
        await this.autoRenewService?.register({
          userId: input.userId,
          provider: "apple",
          providerAgreementId: originalTransactionId,
          latestTransactionId: transaction.transactionId,
          currentPeriodStart: grantPeriodStart,
          currentPeriodEnd: grantPeriodEnd,
          nextPeriodEnd: grantPeriodEnd,
          metadata: autoRenewMetadata,
        });
      }
    } else {
      await this.appleIapAccountLinkRepository?.upsert({
        userId: input.userId,
        appAccountToken: expectedAppAccountToken,
      });
    }

    // Apple 已经支付成功，但 OIO 仍要先确认订阅链可归当前账号，再创建内部 paid order。
    // 否则 originalTransactionId 认领失败时，会留下“订单已 paid、权益没发”的半状态。
    const order = await this.paymentOrderRepository.findOrCreatePaidExternalOrder({
      userId: input.userId,
      productCode: "pro_monthly",
      provider: "apple_iap",
      providerOrderId: transaction.transactionId,
      amount: getRuntimeConfig().payment.proMonthlyPriceCents,
      currency: "CNY",
      metadata: {
        appleIap: {
          environment: transaction.environment,
          transactionId: transaction.transactionId,
          originalTransactionId,
          productId: transaction.productId,
          purchaseKind,
        },
      },
    });

    const sourceOrderId = order.id;
    let alreadyApplied = false;
    try {
      const result = await this.paymentEntitlementService.grantAfterPayment({
        userId: input.userId,
        sourceOrderId,
        productCode: "pro_monthly",
        channel: "ios_iap",
        grantMode,
        periodStart: grantPeriodStart,
        periodEnd: grantPeriodEnd,
        prepaidLimit,
      });
      alreadyApplied = result.alreadyApplied;
    } catch (error) {
      if (error instanceof ProRenewalTooEarlyError) {
        throw error;
      }
      const queued = await this.benefitGrantService.enqueueGrant({
        userId: input.userId,
        sourceOrderId,
        productCode: "pro_monthly",
        channel: "ios_iap",
        payload: createEntitlementGrantPayload({
          fallbackReason: "sync_grant_failed",
          source: "apple_verify_transaction",
          grant: {
            grantMode,
            periodStart: grantPeriodStart,
            periodEnd: grantPeriodEnd,
            prepaidLimit,
          },
        }),
      });
      alreadyApplied = !queued.created;
    }

    return {
      environment: transaction.environment,
      transactionId: transaction.transactionId,
      originalTransactionId,
      productId: transaction.productId,
      purchaseKind,
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

function isAppleSubscriptionBoundRepositoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "APPLE_IAP_APP_ACCOUNT_TOKEN_ALREADY_BOUND" ||
      error.message === "APPLE_IAP_ORIGINAL_TRANSACTION_ALREADY_BOUND")
  );
}

function resolveApplePurchaseKind(
  productId: string,
  config: { proProductId: string; proMonthlyOneTimeProductId: string | null }
): VerifyAppleIapTransactionResult["purchaseKind"] | null {
  if (productId === config.proProductId) return "auto_renew";
  if (config.proMonthlyOneTimeProductId && productId === config.proMonthlyOneTimeProductId) {
    return "single_purchase";
  }
  return null;
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
