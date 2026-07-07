import { createHash } from "node:crypto";
import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { SubscriptionRepository } from "@lf/core/ports/repository/SubscriptionRepository.js";
import type { AppleIapAccountLinkRepository } from "@lf/core/ports/repository/AppleIapAccountLinkRepository.js";
import type { PaymentOrderStatus, PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";
import type { BenefitGrantService } from "../../../services/payment/BenefitGrantService.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import type { AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import type { SubscriptionService } from "../../../services/subscription/SubscriptionService.js";
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
import { fetchSubscriptionStatuses, fetchTransactionInfo, setAppAccountToken } from "./AppleIapClient.js";
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
  productCode: PaymentProductCode;
  purchaseKind: "single_purchase" | "auto_renew";
  sourceOrderId: string;
  alreadyApplied: boolean;
}

export type AppleAutoRenewReconcileResult =
  | { status: "skipped"; reason: string }
  | {
      status: "checked";
      action: "cancelled" | "kept";
      autoRenewSubscriptionId: string;
      providerAgreementId: string;
      latestTransactionId: string | null;
      localStatus: string;
      appleEnvironment: "production" | "sandbox";
      appleStatusCount: number;
      matched: boolean;
      appleStatus: number | null;
      autoRenewStatus: number | null;
      renewalProductId: string | null;
      renewalAutoRenewProductId: string | null;
      transactionProductId: string | null;
    };

type AppleRefundEntitlementRevocationResult =
  | {
      status: "revoked";
      subscriptionId: string;
      userId: string;
      plan: string;
      revokedAt: string;
      expiresAt: string;
    }
  | {
      status: "no_active_subscription";
      sourceOrderId: string;
      revokedAt: string;
    }
  | {
      status: "skipped";
      reason: "subscription_repository_missing";
      sourceOrderId: string;
      revokedAt: string;
    };

export class AppleIapService {
  constructor(
    private readonly benefitGrantService: BenefitGrantService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly paymentEventRepository: PaymentEventRepository,
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly autoRenewService?: AutoRenewService,
    private readonly appleIapAccountLinkRepository?: AppleIapAccountLinkRepository,
    private readonly subscriptionService?: SubscriptionService,
    private readonly subscriptionRepository?: SubscriptionRepository
  ) {}

  isConfigured(): boolean {
    return getRuntimeConfig().payment.appleIap.enabled && isAppleIapConfigured();
  }

  async reconcileCurrentAutoRenewForUser(userId: string): Promise<AppleAutoRenewReconcileResult> {
    if (!this.autoRenewService) return { status: "skipped", reason: "auto_renew_service_missing" };
    if (!this.isConfigured()) return { status: "skipped", reason: "apple_iap_not_configured" };
    const current = await this.autoRenewService.getCurrent(userId);
    const subscription = current.subscription;
    if (!subscription) return { status: "skipped", reason: "no_current_subscription" };
    if (subscription.provider !== "apple") return { status: "skipped", reason: "current_subscription_not_apple" };
    if (!["active", "billing_retry"].includes(subscription.status)) {
      return { status: "skipped", reason: "current_subscription_not_active" };
    }

    const config = loadAppleIapConfig();
    const { token } = createAppleServerTokenWithDiagnostics({
      issuerId: config.issuerId,
      keyId: config.keyId,
      bundleId: config.bundleId,
      privateKeyPem: config.privateKeyPem,
    });
    const appleStatus = await fetchSubscriptionStatuses(
      subscription.providerAgreementId,
      token,
      config.rootCaPem
    );
    const subscriptionProductId = getAppleSubscriptionProductId(config, subscription.productCode);
    if (!subscriptionProductId) return { status: "skipped", reason: "apple_product_id_missing" };
    const matching = findAppleSubscriptionStatus(appleStatus.statuses, {
      originalTransactionId: subscription.providerAgreementId,
      productId: subscriptionProductId,
    });
    const shouldCancel = matching ? shouldCancelAppleAutoRenewFromStatus(matching) : false;
    const result: AppleAutoRenewReconcileResult = {
      status: "checked",
      action: shouldCancel ? "cancelled" : "kept",
      autoRenewSubscriptionId: subscription.id,
      providerAgreementId: subscription.providerAgreementId,
      latestTransactionId: subscription.latestTransactionId,
      localStatus: subscription.status,
      appleEnvironment: appleStatus.environment,
      appleStatusCount: appleStatus.statuses.length,
      matched: Boolean(matching),
      appleStatus: matching?.status ?? null,
      autoRenewStatus: matching?.renewalInfo?.autoRenewStatus ?? null,
      renewalProductId: matching?.renewalInfo?.productId ?? null,
      renewalAutoRenewProductId: matching?.renewalInfo?.autoRenewProductId ?? null,
      transactionProductId: matching?.transaction?.productId ?? null,
    };
    if (!matching || !shouldCancel) return result;

    await this.autoRenewService.handleAppleCancelled({
      originalTransactionId: subscription.providerAgreementId,
      rawPayload: {
        source: "apple_subscription_status_reconcile",
        environment: appleStatus.environment,
        status: matching.status,
        renewalInfo: matching.renewalInfo,
        transaction: matching.transaction,
      },
    });
    return result;
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

  private async backfillMissingAppAccountToken(input: {
    userId: string;
    transaction: Awaited<ReturnType<typeof fetchTransactionInfo>>;
    originalTransactionId: string;
    purchaseKind: "single_purchase" | "auto_renew";
    expectedAppAccountToken: string;
    serverToken: string;
    rootCaPem: string;
  }): Promise<Awaited<ReturnType<typeof fetchTransactionInfo>>> {
    if (!this.appleIapAccountLinkRepository) {
      throw new AppleIapVerifyError(
        "Apple account link repository is not configured",
        "APPLE_IAP_ACCOUNT_LINK_REPOSITORY_NOT_CONFIGURED",
        {
          environment: input.transaction.environment,
          transactionId: input.transaction.transactionId,
          originalTransactionId: input.originalTransactionId,
        }
      );
    }

    for (const providerOrderId of new Set([input.transaction.transactionId, input.originalTransactionId])) {
      const existingOrder = await this.paymentOrderRepository.findByProviderOrderId(providerOrderId);
      if (existingOrder && existingOrder.userId !== input.userId) {
        throw new AppleIapSubscriptionAlreadyBoundError({
          originalTransactionId: input.originalTransactionId,
        });
      }
    }

    const existingByOriginal = await this.appleIapAccountLinkRepository.findByOriginalTransactionId(
      input.originalTransactionId
    );
    if (existingByOriginal && existingByOriginal.userId !== input.userId) {
      throw new AppleIapSubscriptionAlreadyBoundError({
        originalTransactionId: input.originalTransactionId,
      });
    }

    const existingAutoRenew =
      (await this.autoRenewService?.getAppleSubscriptionByOriginalTransactionId(
        input.originalTransactionId
      )) ?? null;
    if (existingAutoRenew && existingAutoRenew.userId !== input.userId) {
      throw new AppleIapSubscriptionAlreadyBoundError({
        originalTransactionId: input.originalTransactionId,
      });
    }

    if (input.purchaseKind === "auto_renew") {
      const periodEnd = input.transaction.expiresDate ? new Date(input.transaction.expiresDate) : null;
      if (!periodEnd || periodEnd <= new Date()) {
        throw new AppleIapVerifyError("Apple subscription is expired", "APPLE_SUBSCRIPTION_EXPIRED", {
          environment: input.transaction.environment,
          transactionId: input.transaction.transactionId,
          originalTransactionId: input.originalTransactionId,
          expiresDate: input.transaction.expiresDate,
        });
      }
    }

    try {
      await this.appleIapAccountLinkRepository.claimOriginalTransactionIfUnbound({
        userId: input.userId,
        appAccountToken: input.expectedAppAccountToken,
        originalTransactionId: input.originalTransactionId,
        latestTransactionId: input.transaction.transactionId,
      });
    } catch (error) {
      if (isAppleSubscriptionBoundRepositoryError(error)) {
        throw new AppleIapSubscriptionAlreadyBoundError({
          originalTransactionId: input.originalTransactionId,
        });
      }
      throw error;
    }

    await setAppAccountToken(
      {
        environment: input.transaction.environment,
        originalTransactionId: input.originalTransactionId,
        appAccountToken: input.expectedAppAccountToken,
      },
      input.serverToken
    );

    const updated = await fetchTransactionInfo(
      input.transaction.transactionId,
      input.serverToken,
      input.rootCaPem
    );
    if (!sameAppleAppAccountToken(updated.appAccountToken, input.expectedAppAccountToken)) {
      throw new AppleIapVerifyError(
        "appAccountToken backfill did not apply",
        "APPLE_APP_ACCOUNT_TOKEN_BACKFILL_FAILED",
        {
          environment: updated.environment,
          transactionId: updated.transactionId,
          originalTransactionId: input.originalTransactionId,
        }
      );
    }

    return updated;
  }

  async verifyProMonthlyTransaction(input: {
    userId: string;
    transactionId: string;
  }): Promise<VerifyAppleIapTransactionResult> {
    return this.verifyMembershipTransaction(input);
  }

  async verifyMembershipTransaction(input: {
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

    const purchase = resolveApplePurchase(transaction.productId, config);
    if (!purchase) {
      throw new AppleIapVerifyError("Product id mismatch", "APPLE_PRODUCT_ID_MISMATCH", {
        expectedProductIds: [
          config.plusProductId,
          config.proProductId,
          config.proMonthlyOneTimeProductId,
        ].filter(Boolean),
        actualProductId: transaction.productId,
        environment: transaction.environment,
      });
    }
    const { purchaseKind, productCode } = purchase;

    const originalTransactionId = transaction.originalTransactionId || transaction.transactionId;
    if (!originalTransactionId) {
      throw new AppleIapVerifyError("Missing originalTransactionId", "APPLE_ORIGINAL_TRANSACTION_ID_MISSING", {
        environment: transaction.environment,
        transactionId: transaction.transactionId,
      });
    }

    const expectedAppAccountToken = createAppleAppAccountToken(input.userId);
    if (!transaction.appAccountToken) {
      transaction = await this.backfillMissingAppAccountToken({
        userId: input.userId,
        transaction,
        originalTransactionId,
        purchaseKind,
        expectedAppAccountToken,
        serverToken: token,
        rootCaPem: config.rootCaPem,
      });
    }
    if (!sameAppleAppAccountToken(transaction.appAccountToken, expectedAppAccountToken)) {
      throw new AppleIapVerifyError("appAccountToken mismatch", "APPLE_APP_ACCOUNT_TOKEN_MISMATCH", {
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
        (await this.autoRenewService?.getAppleSubscriptionByOriginalTransactionId(originalTransactionId)) ?? null;
      const boundUserId =
        existingByOriginal?.userId !== input.userId
          ? existingByOriginal?.userId
          : existingAutoRenew?.userId !== input.userId
            ? existingAutoRenew?.userId
            : null;

      if (boundUserId) {
        const canTransfer = await this.canTransferAppleSubscriptionFromUser({
          boundUserId,
          existingAutoRenew,
          now,
        });
        if (!canTransfer) {
          throw new AppleIapSubscriptionAlreadyBoundError({ originalTransactionId });
        }
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
            productCode,
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
          productCode,
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
    const appleAmount = resolveApplePaymentOrderAmount(transaction, productCode);
    const order = await this.paymentOrderRepository.findOrCreatePaidExternalOrder({
      userId: input.userId,
      productCode,
      provider: "apple_iap",
      providerOrderId: transaction.transactionId,
      amount: appleAmount.amount,
      currency: "CNY",
      metadata: {
        appleIap: {
          environment: transaction.environment,
          transactionId: transaction.transactionId,
          originalTransactionId,
          productId: transaction.productId,
          purchaseKind,
          price: transaction.price,
          currency: transaction.currency,
          amountSource: appleAmount.source,
          amountCents: appleAmount.amount,
        },
      },
    });

    const sourceOrderId = order.id;
    let alreadyApplied = false;
    try {
      const result = await this.paymentEntitlementService.grantAfterPayment({
        userId: input.userId,
        sourceOrderId,
        productCode,
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
        productCode,
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
      productCode,
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
          notification: sanitizeAppleNotificationForStorage(notification),
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
        await this.paymentEventRepository.updateDetails({
          id: event.id,
          providerOrderId: tx.transactionId ?? tx.originalTransactionId ?? null,
          rawPayload: {
            notification: sanitizeAppleNotificationForStorage(notification),
            header: decoded.header,
            transaction: sanitizeAppleTransactionForStorage(tx),
          },
        });

        const purchase = resolveApplePurchase(tx.productId, config);
        if (this.autoRenewService && purchase?.purchaseKind === "auto_renew" && tx.originalTransactionId) {
          const periodStart = tx.purchaseDate ? new Date(tx.purchaseDate) : null;
          const periodEnd = tx.expiresDate ? new Date(tx.expiresDate) : null;
          if (isApplePaidRenewal(notification.notificationType)) {
            // Apple 自动续订由 Apple 扣款；服务端收到 DID_RENEW 等通知后再补发本期权益。
            const result = await this.autoRenewService.handleApplePaidTransaction({
              originalTransactionId: tx.originalTransactionId,
              transactionId: tx.transactionId,
              productCode: purchase.productCode,
              periodStart,
              periodEnd,
              rawPayload: {
                notification: sanitizeAppleNotificationForStorage(notification),
                transaction: tx,
              },
            });
            if (result.status === "ignored" && !result.userId && tx.appAccountToken) {
              await this.handleApplePaidTransactionByAppAccountToken({
                appAccountToken: tx.appAccountToken,
                originalTransactionId: tx.originalTransactionId,
                transactionId: tx.transactionId,
                productCode: purchase.productCode,
                periodStart,
                periodEnd,
                rawPayload: {
                  notification: sanitizeAppleNotificationForStorage(notification),
                  transaction: tx,
                },
              });
            }
          } else if (isAppleCancellationNotice(notification.notificationType, notification.subtype)) {
            await this.autoRenewService.handleAppleCancelled({
              originalTransactionId: tx.originalTransactionId,
              rawPayload: { notification: sanitizeAppleNotificationForStorage(notification), transaction: tx },
            });
          }
        }

        const nextStatus = purchase ? mapAppleEventToOrderStatus(notification.notificationType) : null;
        if (nextStatus) {
          const candidateProviderOrderIds = [
            tx.originalTransactionId,
            tx.transactionId,
            `apple_iap:${tx.originalTransactionId}`,
          ].filter((value): value is string => Boolean(value));
          const order = await this.findOrderByProviderOrderIds(candidateProviderOrderIds);
          if (order) {
            const orderMetadata = buildAppleNotificationOrderMetadata(order.metadata, {
              eventId,
              eventType,
              notificationType: notification.notificationType ?? null,
              subtype: notification.subtype ?? null,
              transactionId: tx.transactionId ?? null,
              originalTransactionId: tx.originalTransactionId ?? null,
            });
            const updatedOrder = await this.paymentOrderRepository.updateStatus({
              id: order.id,
              status: nextStatus,
              expectedCurrentStatuses: getExpectedCurrentStatusesForNextStatus(nextStatus),
              metadata: orderMetadata,
            });
            const effectiveOrder = updatedOrder ?? (order.status === "refunded" ? order : null);
            if (effectiveOrder && isAppleRefundOrRevoke(notification.notificationType)) {
              const revocation = await this.revokeEntitlementForRefundedOrder({
                sourceOrderId: effectiveOrder.id,
                revokedAt: resolveAppleRevocationDate(tx) ?? new Date(),
              });
              await this.paymentOrderRepository.updateStatus({
                id: effectiveOrder.id,
                status: "refunded",
                expectedCurrentStatuses: ["refunded"],
                metadata: buildAppleNotificationOrderMetadata(effectiveOrder.metadata, {
                  eventId,
                  eventType,
                  notificationType: notification.notificationType ?? null,
                  subtype: notification.subtype ?? null,
                  transactionId: tx.transactionId ?? null,
                  originalTransactionId: tx.originalTransactionId ?? null,
                  entitlementRevocation: revocation,
                }),
              });
            }
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

  private async revokeEntitlementForRefundedOrder(input: {
    sourceOrderId: string;
    revokedAt: Date;
  }): Promise<AppleRefundEntitlementRevocationResult> {
    const revokedAt = input.revokedAt.toISOString();
    if (!this.subscriptionRepository) {
      return {
        status: "skipped",
        reason: "subscription_repository_missing",
        sourceOrderId: input.sourceOrderId,
        revokedAt,
      };
    }

    const subscription = await this.subscriptionRepository.cancelActiveBySourceOrderId({
      sourceOrderId: input.sourceOrderId,
      cancelledAt: input.revokedAt,
      expiresAt: input.revokedAt,
    });
    if (!subscription) {
      return {
        status: "no_active_subscription",
        sourceOrderId: input.sourceOrderId,
        revokedAt,
      };
    }

    return {
      status: "revoked",
      subscriptionId: subscription.id,
      userId: subscription.userId,
      plan: subscription.plan,
      revokedAt,
      expiresAt: subscription.expiresAt.toISOString(),
    };
  }

  private async handleApplePaidTransactionByAppAccountToken(input: {
    appAccountToken: string;
    originalTransactionId: string;
    transactionId: string;
    productCode: PaymentProductCode;
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
      productCode: input.productCode,
      metadata: {
        source: "apple_server_notification_app_account_token",
        appAccountToken: input.appAccountToken,
      },
    });
    await this.autoRenewService.handleApplePaidTransaction({
      originalTransactionId: input.originalTransactionId,
      transactionId: input.transactionId,
      productCode: input.productCode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      rawPayload: input.rawPayload,
    });
  }

  private async canTransferAppleSubscriptionFromUser(input: {
    boundUserId: string;
    existingAutoRenew: Awaited<ReturnType<AutoRenewService["getAppleSubscriptionByOriginalTransactionId"]>> | null;
    now: Date;
  }): Promise<boolean> {
    if (!input.existingAutoRenew || input.existingAutoRenew.userId !== input.boundUserId) {
      return false;
    }
    if (!["cancelled", "expired"].includes(input.existingAutoRenew.status)) {
      return false;
    }
    const current = await this.subscriptionService?.getCurrentSubscription(input.boundUserId, input.now);
    return current?.isMember !== true || !current.expiresAt || current.expiresAt <= input.now;
  }

}

function isApplePaidRenewal(notificationType: string | undefined): boolean {
  const type = String(notificationType ?? "").toUpperCase();
  return ["SUBSCRIBED", "DID_RENEW", "DID_RECOVER", "ONE_TIME_CHARGE"].includes(type);
}

function findAppleSubscriptionStatus(
  statuses: Awaited<ReturnType<typeof fetchSubscriptionStatuses>>["statuses"],
  input: { originalTransactionId: string; productId: string }
) {
  return statuses.find((item) => {
    const originalTransactionId =
      item.transaction?.originalTransactionId || item.renewalInfo?.originalTransactionId;
    const productId = item.transaction?.productId || item.renewalInfo?.productId || item.renewalInfo?.autoRenewProductId;
    return originalTransactionId === input.originalTransactionId && productId === input.productId;
  }) ?? null;
}

function shouldCancelAppleAutoRenewFromStatus(
  status: Awaited<ReturnType<typeof fetchSubscriptionStatuses>>["statuses"][number]
): boolean {
  if (status.renewalInfo?.autoRenewStatus === 0) return true;
  // App Store Server API status: 2 = expired, 5 = revoked.
  // In both cases there is no ongoing Apple auto-renew relationship to manage locally.
  return status.status === 2 || status.status === 5;
}

function isAppleCancellationNotice(
  notificationType: string | undefined,
  subtype: string | undefined
): boolean {
  const type = String(notificationType ?? "").toUpperCase();
  const normalizedSubtype = String(subtype ?? "").toUpperCase();
  return (
    ["EXPIRED", "REFUND", "REVOKE"].includes(type) ||
    (type === "DID_CHANGE_RENEWAL_STATUS" && normalizedSubtype === "AUTO_RENEW_DISABLED")
  );
}

function isAppleRefundOrRevoke(notificationType: string | undefined): boolean {
  const type = String(notificationType ?? "").toUpperCase();
  return type === "REFUND" || type === "REVOKE";
}

function resolveAppleRevocationDate(transaction: { revocationDate?: number | null }): Date | null {
  if (typeof transaction.revocationDate !== "number" || !Number.isFinite(transaction.revocationDate)) return null;
  const date = new Date(transaction.revocationDate);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildAppleNotificationOrderMetadata(
  metadata: unknown,
  event: {
    eventId: string;
    eventType: string;
    notificationType: string | null;
    subtype: string | null;
    transactionId: string | null;
    originalTransactionId: string | null;
    entitlementRevocation?: AppleRefundEntitlementRevocationResult;
  }
): Record<string, unknown> {
  const base = asRecord(metadata);
  const appleIap = asRecord(base.appleIap);
  return {
    ...base,
    appleIap: {
      ...appleIap,
      eventId: event.eventId,
      eventType: event.eventType,
      notificationType: event.notificationType,
      subtype: event.subtype,
      transactionId: event.transactionId,
      originalTransactionId: event.originalTransactionId,
      ...(event.entitlementRevocation === undefined
        ? {}
        : { entitlementRevocation: event.entitlementRevocation }),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeAppleNotificationForStorage(notification: AppleServerNotificationPayload): unknown {
  return {
    notificationUUID: notification.notificationUUID ?? null,
    notificationType: notification.notificationType ?? null,
    subtype: notification.subtype ?? null,
    data: {
      environment: notification.data?.environment ?? null,
      // signedTransactionInfo / signedRenewalInfo 都是很长的 JWS。
      // 存库只保留解码后的 tx 摘要，原始 JWS 不进 rawPayload，避免 payment_events/charge 记录膨胀。
      hasSignedTransactionInfo: Boolean(notification.data?.signedTransactionInfo),
      hasSignedRenewalInfo: Boolean(
        (notification.data as { signedRenewalInfo?: unknown } | undefined)?.signedRenewalInfo
      ),
    },
  };
}

function sanitizeAppleTransactionForStorage(transaction: ReturnType<typeof decodeTransactionPayload>): unknown {
  return {
    transactionId: transaction.transactionId ?? null,
    originalTransactionId: transaction.originalTransactionId ?? null,
    productId: transaction.productId ?? null,
    bundleId: transaction.bundleId ?? null,
    signedEnvironment: transaction.signedEnvironment ?? null,
    purchaseDate: transaction.purchaseDate ?? null,
    expiresDate: transaction.expiresDate ?? null,
    revocationDate: transaction.revocationDate ?? null,
    appAccountToken: transaction.appAccountToken ?? null,
  };
}

function isAppleSubscriptionBoundRepositoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "APPLE_IAP_APP_ACCOUNT_TOKEN_ALREADY_BOUND" ||
      error.message === "APPLE_IAP_ORIGINAL_TRANSACTION_ALREADY_BOUND")
  );
}

function resolveApplePurchase(
  productId: string,
  config: { plusProductId: string | null; proProductId: string; proMonthlyOneTimeProductId: string | null }
): { productCode: PaymentProductCode; purchaseKind: VerifyAppleIapTransactionResult["purchaseKind"] } | null {
  if (config.plusProductId && productId === config.plusProductId) {
    return { productCode: "plus_monthly", purchaseKind: "auto_renew" };
  }
  if (productId === config.proProductId) {
    return { productCode: "pro_monthly", purchaseKind: "auto_renew" };
  }
  if (config.proMonthlyOneTimeProductId && productId === config.proMonthlyOneTimeProductId) {
    return { productCode: "pro_monthly", purchaseKind: "single_purchase" };
  }
  return null;
}

function getAppleSubscriptionProductId(
  config: { plusProductId: string | null; proProductId: string },
  productCode: PaymentProductCode
): string | null {
  return productCode === "plus_monthly" ? config.plusProductId : config.proProductId;
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

function sameAppleAppAccountToken(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function resolveApplePaymentOrderAmount(
  transaction: { price: number | null; currency: string | null },
  productCode: PaymentProductCode
): {
  amount: number;
  source: "apple_transaction" | "runtime_config";
} {
  const currency = transaction.currency?.trim().toUpperCase();
  if (currency === "CNY" && typeof transaction.price === "number" && Number.isFinite(transaction.price)) {
    // App Store Server API 的 price 是货币单位的千分之一；库里的 amount 用分。
    const amount = Math.round(transaction.price / 10);
    if (amount > 0) {
      return { amount, source: "apple_transaction" };
    }
  }

  return {
    amount:
      productCode === "plus_monthly"
        ? getRuntimeConfig().payment.plusMonthlyPriceCents
        : getRuntimeConfig().payment.proMonthlyPriceCents,
    source: "runtime_config",
  };
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
