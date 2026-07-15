import type { PaymentEventRepository } from "@lf/core/ports/repository/PaymentEventRepository.js";
import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { SubscriptionRepository } from "@lf/core/ports/repository/SubscriptionRepository.js";
import type { GooglePlayAccountLinkRepository } from "@lf/core/ports/repository/GooglePlayAccountLinkRepository.js";
import type { PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";
import type { PaymentEntitlementService } from "../../../services/payment/PaymentEntitlementService.js";
import type { AutoRenewService } from "../../../services/payment/AutoRenewService.js";
import type { BenefitGrantService } from "../../../services/payment/BenefitGrantService.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";
import { createHash } from "node:crypto";
import { ProRenewalTooEarlyError } from "../../../services/payment/ProPrepaidLimit.js";
import { createEntitlementGrantPayload } from "../../../services/payment/EntitlementGrantSnapshot.js";
import { isGooglePlayBillingConfigured, loadGooglePlayBillingConfig } from "./GooglePlayBillingConfig.js";
import {
  acknowledgeGoogleSubscription,
  cancelGoogleSubscriptionRenewal,
  createGoogleAccessToken,
  fetchGoogleSubscriptionV2,
  type GoogleSubscriptionPurchaseV2,
} from "./GooglePlayBillingClient.js";
import {
  GooglePlayBillingVerifyError,
  GooglePlaySubscriptionAlreadyBoundError,
} from "./GooglePlayBillingErrors.js";
import { GOOGLE_PLAY_AUTORENEW_PROVIDER, GOOGLE_PLAY_PROVIDER } from "./GooglePlayBillingConstants.js";
import {
  googlePlayStateGrantsEntitlement,
  resolveGooglePlayNotificationAction,
} from "./GooglePlaySubscriptionState.js";

export interface VerifyGooglePlayPurchaseResult {
  purchaseToken: string;
  productId: string;
  productCode: PaymentProductCode;
  purchaseKind: "auto_renew";
  autoRenewSubscriptionId: string | null;
  alreadyApplied: boolean;
  acknowledgementPending: boolean;
}

export type GooglePlayAcknowledgeReconcileStatus = "acknowledged" | "pending" | "skipped";

export type GooglePlayAutoRenewReconcileResult =
  | { status: "skipped"; reason: "service_unavailable" | "no_current_google_play_subscription" }
  | {
      status: "checked";
      action: "unchanged" | "paid_period_recorded" | "cancelled" | "suspended";
      subscriptionState: string;
      autoRenewEnabled: boolean;
      currentPeriodEnd: string | null;
    };

export class GooglePlayBillingService {
  constructor(
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly paymentOrderRepository: PaymentOrderRepository,
    private readonly autoRenewService?: AutoRenewService,
    private readonly paymentEventRepository?: PaymentEventRepository,
    private readonly subscriptionRepository?: SubscriptionRepository,
    private readonly benefitGrantService?: BenefitGrantService,
    private readonly googlePlayAccountLinkRepository?: GooglePlayAccountLinkRepository
  ) {}

  isConfigured(): boolean {
    return getRuntimeConfig().payment.googlePlayBilling.enabled && isGooglePlayBillingConfigured();
  }

  async verifySubscriptionPurchase(input: {
    userId: string;
    productId: string;
    purchaseToken: string;
    obfuscatedAccountId?: string | null;
  }): Promise<VerifyGooglePlayPurchaseResult> {
    const config = loadGooglePlayBillingConfig();
    const productCode = resolveGoogleProductCode(input.productId, config);
    if (!productCode) {
      throw new GooglePlayBillingVerifyError("Google Play product id mismatch", "GOOGLE_PLAY_PRODUCT_ID_MISMATCH", {
        expectedProductIds: [config.plusProductId, config.proProductId],
        actualProductId: input.productId,
      });
    }

    const expectedAccountId = createGoogleObfuscatedAccountId(input.userId);
    if (input.obfuscatedAccountId && input.obfuscatedAccountId !== expectedAccountId) {
      throw new GooglePlayBillingVerifyError("Google Play obfuscated account id mismatch", "GOOGLE_PLAY_ACCOUNT_ID_MISMATCH");
    }

    const accessToken = await createGoogleAccessToken(config.credentials);
    const subscription = await fetchGoogleSubscriptionV2({
      packageName: config.packageName,
      purchaseToken: input.purchaseToken,
      accessToken,
    });
    const lineItem = resolveCurrentLineItem(subscription, input.productId);
    if (!lineItem) {
      throw new GooglePlayBillingVerifyError("Google Play subscription line item missing", "GOOGLE_PLAY_LINE_ITEM_MISSING", {
        productId: input.productId,
        subscriptionState: subscription.subscriptionState ?? null,
      });
    }
    assertGoogleLineItemMatchesConfiguredBasePlan(lineItem, productCode, config);

    assertGoogleSubscriptionGrantsEntitlement(subscription);
    const periodStart = parseGoogleDate(subscription.startTime);
    const periodEnd = parseGoogleDate(lineItem.expiryTime);
    if (!periodEnd || periodEnd <= new Date()) {
      throw new GooglePlayBillingVerifyError("Google Play subscription is expired", "GOOGLE_PLAY_SUBSCRIPTION_EXPIRED", {
        productId: input.productId,
        expiryTime: lineItem.expiryTime ?? null,
      });
    }

    const googleAccountId = subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
    if (googleAccountId && googleAccountId !== expectedAccountId) {
      throw new GooglePlayBillingVerifyError("Google Play obfuscated account id mismatch", "GOOGLE_PLAY_ACCOUNT_ID_MISMATCH");
    }
    await this.claimGooglePlayAccountLink({
      userId: input.userId,
      obfuscatedAccountId: expectedAccountId,
      purchaseToken: input.purchaseToken,
      latestOrderId: subscription.latestOrderId ?? null,
    });

    const existingOrder = await this.paymentOrderRepository.findByProviderOrderId(input.purchaseToken);
    if (existingOrder && existingOrder.userId !== input.userId) {
      throw new GooglePlaySubscriptionAlreadyBoundError({ purchaseToken: input.purchaseToken });
    }
    const existingAutoRenew =
      (await this.autoRenewService?.getGooglePlaySubscriptionByPurchaseToken(input.purchaseToken)) ?? null;
    if (existingAutoRenew && existingAutoRenew.userId !== input.userId) {
      throw new GooglePlaySubscriptionAlreadyBoundError({ purchaseToken: input.purchaseToken });
    }
    if (!existingOrder && !existingAutoRenew) {
      await this.paymentEntitlementService.assertCanStartNewProPurchase(input.userId);
    }

    const result = await this.applyInitialGooglePlayPurchase({
      userId: input.userId,
      purchaseToken: input.purchaseToken,
      productId: input.productId,
      productCode,
      lineItem,
      subscription,
      periodStart,
      periodEnd,
      source: "google_play_verify_purchase",
      obfuscatedAccountId: expectedAccountId,
    });
    let acknowledgementPending = false;
    if (subscription.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
      acknowledgementPending = (await this.acknowledgeGooglePlaySubscriptionAfterLocalApply({
        orderId: result.orderId,
        packageName: config.packageName,
        subscriptionId: input.productId,
        purchaseToken: input.purchaseToken,
        accessToken,
      })) === "pending";
    }

    return {
      purchaseToken: input.purchaseToken,
      productId: input.productId,
      productCode,
      purchaseKind: "auto_renew",
      autoRenewSubscriptionId: result.autoRenewSubscriptionId,
      alreadyApplied: result.alreadyApplied,
      acknowledgementPending,
    };
  }

  async registerObfuscatedAccountId(input: {
    userId: string;
    obfuscatedAccountId: string;
  }): Promise<{ obfuscatedAccountId: string }> {
    const expected = createGoogleObfuscatedAccountId(input.userId);
    if (input.obfuscatedAccountId !== expected) {
      throw new GooglePlayBillingVerifyError("Google Play obfuscated account id mismatch", "GOOGLE_PLAY_ACCOUNT_ID_MISMATCH");
    }
    if (!this.googlePlayAccountLinkRepository) {
      throw new Error("GOOGLE_PLAY_ACCOUNT_LINK_REPOSITORY_NOT_CONFIGURED");
    }
    await this.googlePlayAccountLinkRepository.upsert({
      obfuscatedAccountId: expected,
      userId: input.userId,
    });
    return { obfuscatedAccountId: expected };
  }

  async stopSubscriptionRenewalForAccountDeletion(
    purchaseToken: string
  ): Promise<"cancelled" | "already_inactive"> {
    const config = loadGooglePlayBillingConfig();
    const accessToken = await createGoogleAccessToken(config.credentials);
    const subscription = await fetchGoogleSubscriptionV2({
      packageName: config.packageName,
      purchaseToken,
      accessToken,
    });
    const state = String(subscription.subscriptionState ?? "").toUpperCase();
    const hasAutoRenewEnabled = (subscription.lineItems ?? []).some(
      (lineItem) => lineItem.autoRenewingPlan?.autoRenewEnabled === true
    );
    if (
      !hasAutoRenewEnabled ||
      state === "SUBSCRIPTION_STATE_CANCELED" ||
      state === "SUBSCRIPTION_STATE_EXPIRED" ||
      state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
    ) {
      return "already_inactive";
    }
    await cancelGoogleSubscriptionRenewal({
      packageName: config.packageName,
      purchaseToken,
      accessToken,
    });
    return "cancelled";
  }

  async reconcileCurrentAutoRenewForUser(userId: string): Promise<GooglePlayAutoRenewReconcileResult> {
    if (!this.autoRenewService) return { status: "skipped", reason: "service_unavailable" };
    const current = (await this.autoRenewService.getCurrent(userId)).subscription;
    if (!current || current.provider !== GOOGLE_PLAY_AUTORENEW_PROVIDER) {
      return { status: "skipped", reason: "no_current_google_play_subscription" };
    }
    return this.reconcileGooglePlayAutoRenewSubscription(current.providerAgreementId);
  }

  async reconcileGooglePlayAutoRenewSubscription(
    purchaseToken: string
  ): Promise<GooglePlayAutoRenewReconcileResult> {
    if (!this.autoRenewService) return { status: "skipped", reason: "service_unavailable" };
    const local = await this.autoRenewService.getGooglePlaySubscriptionByPurchaseToken(purchaseToken);
    if (!local) return { status: "skipped", reason: "no_current_google_play_subscription" };

    const config = loadGooglePlayBillingConfig();
    const accessToken = await createGoogleAccessToken(config.credentials);
    const subscription = await fetchGoogleSubscriptionV2({
      packageName: config.packageName,
      purchaseToken,
      accessToken,
    });
    const state = String(subscription.subscriptionState ?? "").toUpperCase();
    const autoRenewEnabled = (subscription.lineItems ?? []).some(
      (lineItem) => lineItem.autoRenewingPlan?.autoRenewEnabled === true
    );
    const resolvedProduct = resolveCurrentConfiguredLineItem(subscription, config);
    const lineItem = resolvedProduct?.lineItem ?? null;
    const periodEnd = parseGoogleDate(lineItem?.expiryTime);
    const periodStart = parseGoogleDate(subscription.startTime);
    const providerChargeId = subscription.latestOrderId ?? local.latestTransactionId ?? purchaseToken;
    let paidPeriodRecorded = false;

    if (resolvedProduct && periodEnd) {
      assertGoogleLineItemMatchesConfiguredBasePlan(
        resolvedProduct.lineItem,
        resolvedProduct.productCode,
        config
      );
      const periodChanged =
        local.latestTransactionId !== providerChargeId ||
        local.currentPeriodEnd?.getTime() !== periodEnd.getTime();
      if (periodChanged) {
        await this.autoRenewService.handleGooglePlayPaidTransaction({
          purchaseToken,
          providerChargeId,
          productCode: resolvedProduct.productCode,
          periodStart,
          periodEnd,
          rawPayload: { source: "google_play_active_reconcile", subscription },
        });
        paidPeriodRecorded = true;
      }
    }

    const mustStopAutoRenew =
      !autoRenewEnabled ||
      state === "SUBSCRIPTION_STATE_CANCELED" ||
      state === "SUBSCRIPTION_STATE_EXPIRED" ||
      state === "SUBSCRIPTION_STATE_ON_HOLD" ||
      state === "SUBSCRIPTION_STATE_PAUSED" ||
      state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";
    const periodExpired = Boolean(periodEnd && periodEnd <= new Date());
    const mustSuspendEntitlement =
      periodExpired ||
      state === "SUBSCRIPTION_STATE_EXPIRED" ||
      state === "SUBSCRIPTION_STATE_ON_HOLD" ||
      state === "SUBSCRIPTION_STATE_PAUSED" ||
      state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";

    if (mustStopAutoRenew) {
      await this.autoRenewService.handleGooglePlayCancelled({
        purchaseToken,
        rawPayload: { source: "google_play_active_reconcile", subscription },
      });
    }
    if (mustSuspendEntitlement) {
      await this.suspendCurrentEntitlementForPurchaseToken(
        purchaseToken,
        periodEnd && periodEnd <= new Date() ? periodEnd : new Date()
      );
    }

    return {
      status: "checked",
      action: mustSuspendEntitlement
        ? "suspended"
        : mustStopAutoRenew
          ? "cancelled"
          : paidPeriodRecorded
            ? "paid_period_recorded"
            : "unchanged",
      subscriptionState: state,
      autoRenewEnabled,
      currentPeriodEnd: periodEnd?.toISOString() ?? null,
    };
  }

  async reconcilePendingAcknowledgementOrder(
    orderId: string
  ): Promise<GooglePlayAcknowledgeReconcileStatus> {
    if (!this.isConfigured()) return "skipped";
    const order = await this.paymentOrderRepository.findById(orderId);
    if (!order || order.provider !== GOOGLE_PLAY_PROVIDER || order.status !== "paid") {
      return "skipped";
    }

    const googlePlay = asRecord(asRecord(order.metadata).googlePlay);
    const purchaseToken = readString(googlePlay.purchaseToken) ?? order.providerOrderId;
    const productId = readString(googlePlay.productId);
    if (!purchaseToken || !productId) return "skipped";

    const config = loadGooglePlayBillingConfig();
    const accessToken = await createGoogleAccessToken(config.credentials);
    const subscription = await fetchGoogleSubscriptionV2({
      packageName: config.packageName,
      purchaseToken,
      accessToken,
    });

    if (subscription.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
      await this.markGooglePlayOrderAcknowledged(order.id);
      return "acknowledged";
    }

    const acknowledgementStatus = await this.acknowledgeGooglePlaySubscriptionAfterLocalApply({
      orderId: order.id,
      packageName: config.packageName,
      subscriptionId: productId,
      purchaseToken,
      accessToken,
    });
    return acknowledgementStatus;
  }

  async handleRealtimeDeveloperNotification(input: { messageId: string; rawPayload: unknown }): Promise<{
    status: "processed" | "ignored";
    eventId: string;
    eventType: string;
  }> {
    const decoded = decodeGooglePlayRtdnPayload(input.rawPayload);
    const eventId = input.messageId.trim() || decoded.eventId || `google_play:${Date.now()}`;
    const eventType = decoded.eventType;
    if (!this.paymentEventRepository) return { status: "ignored", eventId, eventType };

    const existing = await this.paymentEventRepository.findByProviderEventId({
      provider: GOOGLE_PLAY_PROVIDER,
      providerEventId: eventId,
      eventType,
    });
    if (existing && !["received", "failed"].includes(existing.status)) {
      return { status: "ignored", eventId, eventType };
    }

    const event = existing ?? await this.paymentEventRepository.findOrCreate({
      provider: GOOGLE_PLAY_PROVIDER,
      providerEventId: eventId,
      providerOrderId: decoded.purchaseToken ?? decoded.orderId ?? null,
      eventType,
      rawPayload: { raw: input.rawPayload, decoded },
    });

    try {
      const handled = await this.processDecodedRealtimeDeveloperNotification(decoded);
      await this.paymentEventRepository.updateDetails({
        id: event.id,
        providerOrderId: decoded.purchaseToken ?? decoded.orderId ?? null,
        rawPayload: { raw: input.rawPayload, decoded, handled },
      });
      if (handled.status === "ignored") {
        await this.paymentEventRepository.markIgnored(event.id, handled.reason);
        return { status: "ignored", eventId, eventType };
      }
      await this.paymentEventRepository.markProcessed(event.id);
      return { status: "processed", eventId, eventType };
    } catch (error) {
      await this.paymentEventRepository.markFailed(
        event.id,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private async processDecodedRealtimeDeveloperNotification(
    decoded: DecodedGooglePlayRtdn
  ): Promise<{ status: "processed"; action: string } | { status: "ignored"; reason: string }> {
    if (decoded.packageName) {
      const config = loadGooglePlayBillingConfig();
      if (decoded.packageName !== config.packageName) {
        return { status: "ignored", reason: "package_name_mismatch" };
      }
    }

    if (decoded.kind === "voided" && decoded.purchaseToken) {
      await this.autoRenewService?.handleGooglePlayCancelled({
        purchaseToken: decoded.purchaseToken,
        rawPayload: decoded.rawNotification,
      });
      await this.revokeCurrentEntitlementForPurchaseToken(decoded.purchaseToken, new Date());
      return { status: "processed", action: "voided_purchase_revoked" };
    }

    if (decoded.kind !== "subscription" || !decoded.purchaseToken) {
      return { status: "ignored", reason: "unsupported_notification_kind" };
    }

    const config = loadGooglePlayBillingConfig();
    const accessToken = await createGoogleAccessToken(config.credentials);
    const subscription = await fetchGoogleSubscriptionV2({
      packageName: config.packageName,
      purchaseToken: decoded.purchaseToken,
      accessToken,
    });
    const resolvedProduct = resolveCurrentConfiguredLineItem(subscription, config);
    if (!resolvedProduct) return { status: "ignored", reason: "product_id_unmapped" };
    const { productId, productCode, lineItem } = resolvedProduct;
    assertGoogleLineItemMatchesConfiguredBasePlan(lineItem, productCode, config);
    const periodStart = parseGoogleDate(subscription.startTime);
    const periodEnd = parseGoogleDate(lineItem.expiryTime);
    const providerChargeId = subscription.latestOrderId ?? decoded.orderId ?? decoded.purchaseToken;
    const notificationAction = resolveGooglePlayNotificationAction({
      notificationType: decoded.notificationType,
      subscriptionState: subscription.subscriptionState,
    });

    if (notificationAction === "revoke") {
      await this.autoRenewService?.handleGooglePlayCancelled({
        purchaseToken: decoded.purchaseToken,
        rawPayload: { notification: decoded.rawNotification, subscription },
      });
      await this.revokeCurrentEntitlementForPurchaseToken(decoded.purchaseToken, new Date());
      return { status: "processed", action: "entitlement_revoked" };
    }

    if (notificationAction === "suspend") {
      await this.autoRenewService?.handleGooglePlayCancelled({
        purchaseToken: decoded.purchaseToken,
        rawPayload: { notification: decoded.rawNotification, subscription },
      });
      await this.suspendCurrentEntitlementForPurchaseToken(decoded.purchaseToken, new Date());
      return { status: "processed", action: "entitlement_suspended" };
    }

    if (notificationAction === "cancel") {
      await this.autoRenewService?.handleGooglePlayCancelled({
        purchaseToken: decoded.purchaseToken,
        rawPayload: { notification: decoded.rawNotification, subscription },
      });
      return { status: "processed", action: "auto_renew_cancelled" };
    }

    if (notificationAction === "sync") {
      if (!periodEnd || periodEnd <= new Date()) {
        return { status: "ignored", reason: "subscription_period_expired" };
      }
      if (await this.hasInitialPurchaseGrantCoveringPeriod(decoded.purchaseToken, periodEnd)) {
        return { status: "processed", action: "initial_purchase_already_applied" };
      }
      const initialUserId = await this.resolveGooglePlayUserIdForNotification({
        purchaseToken: decoded.purchaseToken,
        subscription,
      });
      if (initialUserId) {
        const result = await this.applyInitialGooglePlayPurchase({
          userId: initialUserId,
          purchaseToken: decoded.purchaseToken,
          productId,
          productCode,
          lineItem,
          subscription,
          periodStart,
          periodEnd,
          source: "google_play_rtdn_initial_purchase",
          obfuscatedAccountId: subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
        });
        if (subscription.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
          await this.acknowledgeGooglePlaySubscriptionAfterLocalApply({
            orderId: result.orderId,
            packageName: config.packageName,
            subscriptionId: productId,
            purchaseToken: decoded.purchaseToken,
            accessToken,
          });
        }
        if (!result.alreadyApplied) {
          return { status: "processed", action: "initial_purchase_applied_from_rtdn" };
        }
      }
      await this.autoRenewService?.handleGooglePlayPaidTransaction({
        purchaseToken: decoded.purchaseToken,
        providerChargeId,
        productCode,
        periodStart,
        periodEnd,
        rawPayload: { notification: decoded.rawNotification, subscription },
      });
      return { status: "processed", action: "paid_transaction_recorded" };
    }

    return { status: "ignored", reason: "notification_type_noop" };
  }

  private async revokeCurrentEntitlementForPurchaseToken(
    purchaseToken: string,
    revokedAt: Date
  ): Promise<void> {
    await this.suspendCurrentEntitlementForPurchaseToken(purchaseToken, revokedAt);
    const order = await this.paymentOrderRepository.findByProviderOrderId(purchaseToken);
    if (!order) return;
    await this.paymentOrderRepository.updateStatus({
      id: order.id,
      status: "refunded",
      expectedCurrentStatuses: ["paid", "refunded"],
      metadata: mergeMetadata(order.metadata, {
        googlePlay: {
          ...asRecord(asRecord(order.metadata).googlePlay),
          entitlementRevokedAt: revokedAt.toISOString(),
        },
      }),
    });
  }

  private async suspendCurrentEntitlementForPurchaseToken(
    purchaseToken: string,
    suspendedAt: Date
  ): Promise<void> {
    if (!this.subscriptionRepository) return;
    const order = await this.paymentOrderRepository.findByProviderOrderId(purchaseToken);
    if (order) {
      await this.subscriptionRepository.cancelActiveBySourceOrderId({
        sourceOrderId: order.id,
        cancelledAt: suspendedAt,
        expiresAt: suspendedAt,
      });
    }
    const autoRenew = await this.autoRenewService?.getGooglePlaySubscriptionByPurchaseToken(purchaseToken);
    const latestTransactionId = autoRenew?.latestTransactionId;
    if (latestTransactionId) {
      await this.subscriptionRepository.cancelActiveBySourceOrderId({
        sourceOrderId: `google_play_iap:${latestTransactionId}`,
        cancelledAt: suspendedAt,
        expiresAt: suspendedAt,
      });
    }
  }

  private async applyInitialGooglePlayPurchase(input: {
    userId: string;
    purchaseToken: string;
    productId: string;
    productCode: PaymentProductCode;
    lineItem: NonNullable<GoogleSubscriptionPurchaseV2["lineItems"]>[number];
    subscription: GoogleSubscriptionPurchaseV2;
    periodStart: Date | null;
    periodEnd: Date;
    source: string;
    obfuscatedAccountId: string | null;
  }): Promise<{ orderId: string; autoRenewSubscriptionId: string | null; alreadyApplied: boolean }> {
    const amount = resolveGooglePaymentOrderAmount(input.lineItem, input.productCode);
    const order = await this.paymentOrderRepository.findOrCreatePaidExternalOrder({
      userId: input.userId,
      productCode: input.productCode,
      provider: GOOGLE_PLAY_PROVIDER,
      providerOrderId: input.purchaseToken,
      amount: amount.amount,
      currency: amount.currency,
      metadata: {
        googlePlay: {
          purchaseToken: input.purchaseToken,
          latestOrderId: input.subscription.latestOrderId ?? null,
          productId: input.productId,
          productCode: input.productCode,
          subscriptionState: input.subscription.subscriptionState ?? null,
          acknowledgementState: input.subscription.acknowledgementState ?? null,
          basePlanId: input.lineItem.offerDetails?.basePlanId ?? null,
          offerId: input.lineItem.offerDetails?.offerId ?? null,
          amountSource: amount.source,
        },
      },
    });
    const autoRenew = await this.autoRenewService?.register({
      userId: input.userId,
      provider: GOOGLE_PLAY_AUTORENEW_PROVIDER,
      providerAgreementId: input.purchaseToken,
      latestTransactionId: input.subscription.latestOrderId ?? input.purchaseToken,
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: input.periodEnd,
      nextPeriodEnd: input.periodEnd,
      productCode: input.productCode,
      metadata: {
        source: input.source,
        productId: input.productId,
        basePlanId: input.lineItem.offerDetails?.basePlanId ?? null,
        offerId: input.lineItem.offerDetails?.offerId ?? null,
        subscriptionState: input.subscription.subscriptionState ?? null,
        obfuscatedAccountId: input.obfuscatedAccountId,
      },
    });

    let alreadyApplied = false;
    try {
      const grant = await this.paymentEntitlementService.grantAfterPayment({
        userId: input.userId,
        sourceOrderId: order.id,
        productCode: input.productCode,
        channel: "android_iap",
        grantMode: "subscription_period",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        prepaidLimit: "skip",
      });
      alreadyApplied = grant.alreadyApplied;
    } catch (error) {
      if (error instanceof ProRenewalTooEarlyError) throw error;
      if (!this.benefitGrantService) throw error;
      await this.benefitGrantService.enqueueGrant({
        userId: input.userId,
        sourceOrderId: order.id,
        productCode: input.productCode,
        channel: "android_iap",
        payload: createEntitlementGrantPayload({
          fallbackReason: "sync_grant_failed",
          source: input.source,
          grant: {
            grantMode: "subscription_period",
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            prepaidLimit: "skip",
          },
        }),
      });
    }

    return { orderId: order.id, autoRenewSubscriptionId: autoRenew?.id ?? null, alreadyApplied };
  }

  private async acknowledgeGooglePlaySubscriptionAfterLocalApply(input: {
    orderId: string;
    packageName: string;
    subscriptionId: string;
    purchaseToken: string;
    accessToken: string;
  }): Promise<"acknowledged" | "pending"> {
    try {
      await acknowledgeGoogleSubscription({
        packageName: input.packageName,
        subscriptionId: input.subscriptionId,
        purchaseToken: input.purchaseToken,
        accessToken: input.accessToken,
      });
      const order = await this.paymentOrderRepository.findById(input.orderId);
      if (!order) return "acknowledged";
      await this.markGooglePlayOrderAcknowledged(order.id);
      return "acknowledged";
    } catch (error) {
      const order = await this.paymentOrderRepository.findById(input.orderId);
      if (order) {
        await this.paymentOrderRepository.updateStatus({
          id: order.id,
          status: order.status,
          expectedCurrentStatuses: [order.status],
          metadata: mergeMetadata(order.metadata, {
            googlePlay: {
              ...asRecord(asRecord(order.metadata).googlePlay),
              acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
              acknowledgeFailedAt: new Date().toISOString(),
              acknowledgeError: error instanceof Error ? error.message : String(error),
            },
          }),
        });
      }
      if (isRetryableGooglePlayAcknowledgeError(error)) return "pending";
      throw error;
    }
  }

  private async markGooglePlayOrderAcknowledged(orderId: string): Promise<void> {
    const order = await this.paymentOrderRepository.findById(orderId);
    if (!order) return;
    await this.paymentOrderRepository.updateStatus({
      id: order.id,
      status: order.status,
      expectedCurrentStatuses: [order.status],
      metadata: mergeMetadata(order.metadata, {
        googlePlay: {
          ...asRecord(asRecord(order.metadata).googlePlay),
          acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
          acknowledgedAt: new Date().toISOString(),
          acknowledgeFailedAt: null,
          acknowledgeError: null,
        },
      }),
    });
  }

  private async claimGooglePlayAccountLink(input: {
    userId: string;
    obfuscatedAccountId: string;
    purchaseToken: string;
    latestOrderId?: string | null;
  }): Promise<void> {
    if (!this.googlePlayAccountLinkRepository) return;
    try {
      await this.googlePlayAccountLinkRepository.claimPurchaseToken(input);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "GOOGLE_PLAY_ACCOUNT_ID_ALREADY_BOUND" ||
          error.message === "GOOGLE_PLAY_PURCHASE_TOKEN_ALREADY_BOUND")
      ) {
        throw new GooglePlaySubscriptionAlreadyBoundError({ purchaseToken: input.purchaseToken });
      }
      throw error;
    }
  }

  private async resolveGooglePlayUserIdForNotification(input: {
    purchaseToken: string;
    subscription: GoogleSubscriptionPurchaseV2;
  }): Promise<string | null> {
    const existing = await this.autoRenewService?.getGooglePlaySubscriptionByPurchaseToken(input.purchaseToken);
    if (existing) return null;
    const obfuscatedAccountId = input.subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
    if (!obfuscatedAccountId || !this.googlePlayAccountLinkRepository) return null;
    const link = await this.googlePlayAccountLinkRepository.findByObfuscatedAccountId(obfuscatedAccountId);
    if (!link) return null;
    await this.claimGooglePlayAccountLink({
      userId: link.userId,
      obfuscatedAccountId,
      purchaseToken: input.purchaseToken,
      latestOrderId: input.subscription.latestOrderId ?? null,
    });
    return link.userId;
  }

  private async hasInitialPurchaseGrantCoveringPeriod(
    purchaseToken: string,
    periodEnd: Date
  ): Promise<boolean> {
    if (!this.subscriptionRepository) return false;
    const order = await this.paymentOrderRepository.findByProviderOrderId(purchaseToken);
    if (!order) return false;
    const subscription = await this.subscriptionRepository.findBySourceOrderId(order.id);
    return Boolean(
      subscription &&
        subscription.status === "active" &&
        subscription.expiresAt >= periodEnd
    );
  }
}

function isRetryableGooglePlayAcknowledgeError(error: unknown): boolean {
  if (!(error instanceof GooglePlayBillingVerifyError)) return false;
  if (error.code === "GOOGLE_API_NETWORK_ERROR") return true;
  const match = error.code.match(/^GOOGLE_PLAY_ACK_HTTP_(\d{3})$/);
  if (!match) return false;
  const status = Number(match[1]);
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function resolveGoogleProductCode(
  productId: string,
  config: { plusProductId: string; proProductId: string }
): PaymentProductCode | null {
  if (productId === config.plusProductId) return "plus_monthly";
  if (productId === config.proProductId) return "pro_monthly";
  return null;
}

function resolveCurrentLineItem(subscription: GoogleSubscriptionPurchaseV2, productId: string) {
  const rows = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  return rows
    .filter((item) => item.productId === productId)
    .sort((left, right) => (Date.parse(right.expiryTime ?? "") || 0) - (Date.parse(left.expiryTime ?? "") || 0))[0] ?? null;
}

function resolveCurrentConfiguredLineItem(
  subscription: GoogleSubscriptionPurchaseV2,
  config: { plusProductId: string; proProductId: string }
): {
  productId: string;
  productCode: PaymentProductCode;
  lineItem: NonNullable<GoogleSubscriptionPurchaseV2["lineItems"]>[number];
} | null {
  const rows = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  const candidates = rows
    .map((lineItem) => {
      const productId = lineItem.productId?.trim() ?? "";
      const productCode = resolveGoogleProductCode(productId, config);
      return productCode ? { productId, productCode, lineItem } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (left, right) =>
        (Date.parse(right.lineItem.expiryTime ?? "") || 0) -
        (Date.parse(left.lineItem.expiryTime ?? "") || 0)
    );
  return candidates[0] ?? null;
}

function assertGoogleLineItemMatchesConfiguredBasePlan(
  lineItem: NonNullable<GoogleSubscriptionPurchaseV2["lineItems"]>[number],
  productCode: PaymentProductCode,
  config: {
    plusBasePlanId: string | null;
    proBasePlanId: string | null;
  }
): void {
  const expectedBasePlanId = productCode === "plus_monthly" ? config.plusBasePlanId : config.proBasePlanId;
  const actualBasePlanId = lineItem.offerDetails?.basePlanId ?? null;
  if (expectedBasePlanId && actualBasePlanId !== expectedBasePlanId) {
    throw new GooglePlayBillingVerifyError("Google Play base plan mismatch", "GOOGLE_PLAY_BASE_PLAN_MISMATCH", {
      expectedBasePlanId,
      actualBasePlanId,
    });
  }
}

function assertGoogleSubscriptionGrantsEntitlement(subscription: GoogleSubscriptionPurchaseV2): void {
  if (googlePlayStateGrantsEntitlement(subscription.subscriptionState)) return;
  throw new GooglePlayBillingVerifyError("Google Play subscription is not active", "GOOGLE_PLAY_SUBSCRIPTION_INACTIVE", {
    subscriptionState: subscription.subscriptionState ?? null,
  });
}

function parseGoogleDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function createGoogleObfuscatedAccountId(userId: string): string {
  const hash = createHash("sha256").update(`oio:${userId}`).digest("hex");
  return `oio_${hash.slice(0, 32)}`;
}

function resolveGooglePaymentOrderAmount(
  lineItem: NonNullable<GoogleSubscriptionPurchaseV2["lineItems"]>[number],
  productCode: PaymentProductCode
): { amount: number; currency: string; source: "google_recurring_price" | "runtime_config" } {
  const price = lineItem.autoRenewingPlan?.recurringPrice;
  const currency = price?.currencyCode?.trim().toUpperCase();
  const amount = moneyToMinorUnits(price, currency);
  if (currency && amount !== null && amount > 0) {
    return { amount, currency, source: "google_recurring_price" };
  }
  const runtime = getRuntimeConfig();
  return {
    amount:
      productCode === "plus_monthly"
        ? runtime.payment.plusMonthlyPriceCents
        : runtime.payment.proMonthlyPriceCents,
    currency: "CNY",
    source: "runtime_config",
  };
}

function moneyToMinorUnits(
  price: { units?: string | number; nanos?: number } | undefined,
  currency: string | undefined
): number | null {
  if (!price || !currency) return null;
  const units = typeof price.units === "number" ? price.units : Number.parseInt(price.units ?? "0", 10);
  const nanos = typeof price.nanos === "number" ? price.nanos : 0;
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  const minorUnitDigits = getCurrencyMinorUnitDigits(currency);
  const unitMultiplier = 10 ** minorUnitDigits;
  return Math.round(units * unitMultiplier + (nanos / 1_000_000_000) * unitMultiplier);
}

function getCurrencyMinorUnitDigits(currency: string): number {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).formatToParts(1);
    return parts.find((part) => part.type === "fraction")?.value.length ?? 0;
  } catch {
    return 2;
  }
}

type DecodedGooglePlayRtdn = {
  kind: "subscription" | "voided" | "one_time" | "test" | "unknown";
  eventId: string | null;
  eventType: string;
  packageName: string | null;
  purchaseToken: string | null;
  productId: string | null;
  orderId: string | null;
  notificationType: number | null;
  rawNotification: unknown;
};

function decodeGooglePlayRtdnPayload(rawPayload: unknown): DecodedGooglePlayRtdn {
  const envelope = asRecord(rawPayload);
  const message = asRecord(envelope.message);
  const decodedData = decodePubSubData(message.data);
  const payload = decodedData ? asRecord(decodedData) : envelope;
  const subscription = asRecord(payload.subscriptionNotification);
  const voided = asRecord(payload.voidedPurchaseNotification);
  const oneTime = asRecord(payload.oneTimeProductNotification);
  const test = asRecord(payload.testNotification);
  const packageName = readString(payload.packageName);
  const eventTime = readString(payload.eventTimeMillis);

  if (Object.keys(subscription).length > 0) {
    const notificationType = readNumber(subscription.notificationType);
    const purchaseToken = readString(subscription.purchaseToken);
    return {
      kind: "subscription",
      eventId: buildGoogleEventId({ eventTime, purchaseToken, notificationType }),
      eventType: `SUBSCRIPTION.${notificationType ?? "UNKNOWN"}`,
      packageName,
      purchaseToken,
      productId: null,
      orderId: null,
      notificationType,
      rawNotification: payload,
    };
  }

  if (Object.keys(voided).length > 0) {
    const purchaseToken = readString(voided.purchaseToken);
    const orderId = readString(voided.orderId);
    const refundType = readNumber(voided.refundType);
    return {
      kind: "voided",
      eventId: buildGoogleEventId({ eventTime, purchaseToken, orderId, notificationType: refundType }),
      eventType: `VOIDED.${refundType ?? "UNKNOWN"}`,
      packageName,
      purchaseToken,
      productId: null,
      orderId,
      notificationType: refundType,
      rawNotification: payload,
    };
  }

  if (Object.keys(oneTime).length > 0) {
    const notificationType = readNumber(oneTime.notificationType);
    const purchaseToken = readString(oneTime.purchaseToken);
    const productId = readString(oneTime.sku);
    return {
      kind: "one_time",
      eventId: buildGoogleEventId({ eventTime, purchaseToken, productId, notificationType }),
      eventType: `ONE_TIME.${notificationType ?? "UNKNOWN"}`,
      packageName,
      purchaseToken,
      productId,
      orderId: null,
      notificationType,
      rawNotification: payload,
    };
  }

  if (Object.keys(test).length > 0) {
    return {
      kind: "test",
      eventId: readString(message.messageId) ?? eventTime,
      eventType: "TEST",
      packageName,
      purchaseToken: null,
      productId: null,
      orderId: null,
      notificationType: null,
      rawNotification: payload,
    };
  }

  return {
    kind: "unknown",
    eventId: readString(message.messageId) ?? eventTime,
    eventType: "UNKNOWN",
    packageName,
    purchaseToken: null,
    productId: null,
    orderId: null,
    notificationType: null,
    rawNotification: payload,
  };
}

function decodePubSubData(value: unknown): unknown | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function buildGoogleEventId(input: {
  eventTime: string | null;
  purchaseToken?: string | null;
  productId?: string | null;
  orderId?: string | null;
  notificationType: number | null;
}): string | null {
  const parts = [
    input.eventTime,
    input.purchaseToken,
    input.orderId,
    input.productId,
    input.notificationType === null ? null : String(input.notificationType),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(":") : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...asRecord(existing),
    ...patch,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
