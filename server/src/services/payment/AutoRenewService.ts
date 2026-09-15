import type {
  AutoRenewChargeEntity,
  AutoRenewProductCode,
  AutoRenewProvider,
  AutoRenewRepository,
  AutoRenewSubscriptionEntity,
} from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { PaymentEntitlementService } from "./PaymentEntitlementService.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import { computeEarlyBillingAt } from "./AutoRenewBillingSchedule.js";

export interface CurrentAutoRenewView {
  subscription: AutoRenewSubscriptionEntity | null;
}

export interface RegisterAutoRenewInput {
  userId: string;
  provider: AutoRenewProvider;
  productCode?: AutoRenewProductCode;
  providerAgreementId: string;
  status?: "pending" | "active";
  latestTransactionId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  nextPeriodEnd?: Date | null;
  nextBillingAt?: Date | null;
  metadata?: unknown | null;
}

export interface RecordPaidChargeInput {
  userId: string;
  provider: AutoRenewProvider;
  productCode?: AutoRenewProductCode;
  providerAgreementId: string;
  providerChargeId: string;
  periodKey?: string | null;
  amount?: number | null;
  currency?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  paidAt?: Date | null;
  rawPayload?: unknown | null;
}

export class AutoRenewNotFoundError extends Error {
  readonly code = "AUTO_RENEW_NOT_FOUND";

  constructor() {
    super("Auto renew subscription not found");
  }
}

export class AutoRenewAccessDeniedError extends Error {
  readonly code = "AUTO_RENEW_NOT_FOUND";

  constructor() {
    super("Auto renew subscription not found");
  }
}

export class AutoRenewAlreadyActiveError extends Error {
  readonly code = "AUTO_RENEW_ALREADY_ACTIVE";
  readonly provider: AutoRenewProvider;

  constructor(provider: AutoRenewProvider) {
    super("Auto renew is already active for this user");
    this.provider = provider;
  }
}

export class AutoRenewConcurrentCreateError extends Error {
  readonly code = "AUTO_RENEW_ALREADY_ACTIVE";

  constructor() {
    super("Auto renew is already active for this user");
  }
}

export class AutoRenewSwitchBlockedError extends Error {
  readonly code = "AUTO_RENEW_SWITCH_BLOCKED";
  readonly provider: AutoRenewProvider;
  readonly currentPeriodEnd: Date;

  constructor(input: { provider: AutoRenewProvider; currentPeriodEnd: Date }) {
    super("Cannot switch auto renew provider while current membership period is still active");
    this.provider = input.provider;
    this.currentPeriodEnd = input.currentPeriodEnd;
  }
}

export class AutoRenewPlanAlreadyCurrentError extends Error {
  readonly code = "AUTO_RENEW_PLAN_ALREADY_CURRENT";

  constructor() {
    super("Requested plan is already current");
  }
}

export class AutoRenewPlanChangePendingError extends Error {
  readonly code = "AUTO_RENEW_PLAN_CHANGE_ALREADY_PENDING";

  constructor() {
    super("Another subscription plan change is already pending");
  }
}

const PLAN_CHANGE_CONFIRMATION_TIMEOUT_MS = 60 * 60 * 1000;

export type AutoRenewPlanChangeRecoveryResult =
  | { status: "not_pending" | "scheduled" | "waiting" }
  | { status: "released"; subscriptionId: string };

export class AutoRenewService {
  constructor(
    private readonly autoRenewRepository: AutoRenewRepository,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly subscriptionService?: SubscriptionService
  ) {}

  async getCurrent(userId: string): Promise<CurrentAutoRenewView> {
    return {
      // 自动续费状态按 userId 查，而不是按设备/渠道查。
      // 用户跨设备或跨平台登录时仍能看到同一份订阅，避免重复签约。
      subscription: await this.autoRenewRepository.findCurrentByUserId(userId),
    };
  }

  async getAppleSubscriptionByOriginalTransactionId(
    originalTransactionId: string
  ): Promise<AutoRenewSubscriptionEntity | null> {
    return this.autoRenewRepository.findByProviderAgreement({
      provider: "apple",
      providerAgreementId: originalTransactionId,
    });
  }

  async getGooglePlaySubscriptionByPurchaseToken(
    purchaseToken: string
  ): Promise<AutoRenewSubscriptionEntity | null> {
    return this.autoRenewRepository.findByProviderAgreement({
      provider: "google_play",
      providerAgreementId: purchaseToken,
    });
  }

  async transferAppleSubscriptionToUser(input: {
    subscriptionId: string;
    userId: string;
    latestTransactionId: string;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    productCode?: AutoRenewProductCode;
    metadata?: unknown;
  }): Promise<AutoRenewSubscriptionEntity> {
    return this.autoRenewRepository.updateSubscription({
      id: input.subscriptionId,
      userId: input.userId,
      ...(input.productCode ? appliedProductFields(null, input.productCode) : {}),
      status: "active",
      metadata: input.metadata,
      latestTransactionId: input.latestTransactionId,
      currentPeriodStart: input.periodStart ?? null,
      currentPeriodEnd: input.periodEnd ?? null,
      nextBillingAt: input.periodEnd ? computeEarlyBillingAt(input.periodEnd) : null,
      cancelledAt: null,
      allowReactivation: true,
    });
  }

  async register(input: RegisterAutoRenewInput): Promise<AutoRenewSubscriptionEntity> {
    const currentForUser = await this.autoRenewRepository.findActiveByUserId(input.userId);
    if (
      currentForUser &&
      (currentForUser.provider !== input.provider ||
        currentForUser.providerAgreementId !== input.providerAgreementId)
    ) {
      // 自动续费是用户级权益，不是设备级权益。
      // 同一个用户已在任一渠道开通时，另一端只能展示状态，不能再开第二份自动续费。
      throw new AutoRenewAlreadyActiveError(currentForUser.provider);
    }

    await this.assertCanCreateAfterCancellation({
      userId: input.userId,
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });

    const existing = await this.autoRenewRepository.findByProviderAgreement({
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });

    if (existing) {
      if (input.status === "active" && (input.latestTransactionId || input.currentPeriodEnd)) {
        return this.autoRenewRepository.updateSubscription({
          id: existing.id,
          userId: input.userId,
          ...(input.productCode ? appliedProductFields(existing, input.productCode) : {}),
          status: "active",
          latestTransactionId: input.latestTransactionId ?? existing.latestTransactionId,
          currentPeriodStart: input.currentPeriodStart ?? existing.currentPeriodStart,
          currentPeriodEnd: input.currentPeriodEnd ?? existing.currentPeriodEnd,
          nextBillingAt:
            input.nextBillingAt ??
            (input.nextPeriodEnd ? computeEarlyBillingAt(input.nextPeriodEnd) : existing.nextBillingAt),
          cancelledAt: null,
          metadata: input.metadata ?? existing.metadata,
          allowReactivation: true,
        });
      }
      return existing;
    }

    try {
      return await this.autoRenewRepository.createSubscription({
        userId: input.userId,
        provider: input.provider,
        productCode: input.productCode ?? "pro_monthly",
        status: input.status ?? "active",
        providerAgreementId: input.providerAgreementId,
        latestTransactionId: input.latestTransactionId ?? null,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        nextBillingAt:
          input.nextBillingAt ??
          (input.nextPeriodEnd ? computeEarlyBillingAt(input.nextPeriodEnd) : null),
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const latest = await this.autoRenewRepository.findActiveByUserId(input.userId);
      if (latest) throw new AutoRenewAlreadyActiveError(latest.provider);
      // 并发创建时数据库唯一索引是最后防线；如果查不到具体 provider，也按已开通处理。
      throw new AutoRenewConcurrentCreateError();
    }
  }

  async requestPlanChange(input: {
    userId: string;
    autoRenewSubscriptionId: string;
    targetProductCode: AutoRenewProductCode;
    requestedAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{
    subscription: AutoRenewSubscriptionEntity;
    timing: "immediate" | "period_end";
    effectiveAt: Date | null;
  }> {
    const current = await this.autoRenewRepository.findById(input.autoRenewSubscriptionId);
    if (!current || current.userId !== input.userId) throw new AutoRenewAccessDeniedError();
    if (!["active", "billing_retry"].includes(current.status)) throw new AutoRenewNotFoundError();
    const requestedAt = input.requestedAt ?? new Date();
    if (readBooleanMetadata(current.metadata, "cancelAtPeriodEnd")) {
      throw new Error("AUTO_RENEW_PLAN_CHANGE_WHILE_CANCEL_SCHEDULED");
    }

    if (current.productCode === input.targetProductCode) {
      // Google Play cancels a deferred replacement by launching another
      // replacement purchase for the currently active plan. Keep the existing
      // scheduled target until Play confirms the reversal; provider
      // reconciliation will then clear it atomically.
      if (
        current.provider === "google_play" &&
        current.pendingProductCode &&
        current.pendingChangeStatus === "scheduled"
      ) {
        const effectiveAt = current.pendingChangeEffectiveAt ?? current.currentPeriodEnd;
        if (!effectiveAt || effectiveAt <= requestedAt) {
          throw new Error("AUTO_RENEW_PLAN_CHANGE_REVERSAL_WINDOW_CLOSED");
        }
        return {
          subscription: current,
          timing: "period_end",
          effectiveAt,
        };
      }
      throw new AutoRenewPlanAlreadyCurrentError();
    }

    if (current.pendingProductCode) {
      if (current.pendingProductCode !== input.targetProductCode) {
        throw new AutoRenewPlanChangePendingError();
      }
      return {
        subscription: current,
        timing: current.pendingChangeEffectiveAt ? "period_end" : "immediate",
        effectiveAt: current.pendingChangeEffectiveAt,
      };
    }

    const timing = isTierUpgrade(current.productCode, input.targetProductCode)
      ? "immediate" as const
      : "period_end" as const;
    const effectiveAt = timing === "period_end" ? current.currentPeriodEnd : null;
    if (timing === "period_end" && !effectiveAt) {
      throw new Error("AUTO_RENEW_CURRENT_PERIOD_END_MISSING");
    }
    const metadata = mergeMetadata(current.metadata, {
      planChange: {
        fromProductCode: current.productCode,
        toProductCode: input.targetProductCode,
        timing,
        requestedAt: requestedAt.toISOString(),
        ...input.metadata,
      },
    });
    const subscription = await this.autoRenewRepository.reservePlanChange({
      id: current.id,
      userId: input.userId,
      pendingProductCode: input.targetProductCode,
      pendingChangeEffectiveAt: effectiveAt,
      pendingChangeRequestedAt: requestedAt,
      metadata,
    });
    if (!subscription) throw new AutoRenewPlanChangePendingError();
    return { subscription, timing, effectiveAt };
  }

  /**
   * Release a StoreKit/Play purchase reservation only when the client has
   * explicitly reported that the purchase sheet was abandoned. Scheduled
   * provider changes are never cleared by this path.
   */
  async abandonUnconfirmedPlanChange(input: {
    userId: string;
    autoRenewSubscriptionId: string;
    targetProductCode: AutoRenewProductCode;
    abandonedAt?: Date;
  }): Promise<AutoRenewPlanChangeRecoveryResult> {
    const current = await this.autoRenewRepository.findById(input.autoRenewSubscriptionId);
    if (!current || current.userId !== input.userId) throw new AutoRenewAccessDeniedError();
    if (!current.pendingProductCode) return { status: "not_pending" };
    if (current.pendingChangeStatus === "scheduled") return { status: "scheduled" };
    if (
      current.pendingChangeStatus !== "pending_confirmation" ||
      current.pendingProductCode !== input.targetProductCode ||
      !current.pendingChangeRequestedAt
    ) {
      throw new AutoRenewPlanChangePendingError();
    }
    const abandonedAt = input.abandonedAt ?? new Date();
    const released = await this.autoRenewRepository.releasePlanChangeReservation({
      id: current.id,
      pendingChangeRequestedAt: current.pendingChangeRequestedAt,
      metadata: mergeMetadata(current.metadata, {
        planChangeRecovery: {
          reason: "client_purchase_abandoned",
          targetProductCode: current.pendingProductCode,
          recoveredAt: abandonedAt.toISOString(),
        },
      }),
    });
    return released
      ? { status: "released", subscriptionId: current.id }
      : { status: "not_pending" };
  }

  /**
   * Called only after an authoritative provider query found no matching
   * current or scheduled change. The grace window protects slow notifications
   * and eventual consistency; the conditional repository update protects a
   * notification racing with this cleanup.
   */
  async recoverStaleUnconfirmedPlanChange(input: {
    provider: AutoRenewProvider;
    providerAgreementId: string;
    checkedAt?: Date;
  }): Promise<AutoRenewPlanChangeRecoveryResult> {
    const current = await this.autoRenewRepository.findByProviderAgreement({
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });
    if (!current?.pendingProductCode || !current.pendingChangeRequestedAt) {
      return { status: "not_pending" };
    }
    if (current.pendingChangeStatus === "scheduled") return { status: "scheduled" };
    if (current.pendingChangeStatus !== "pending_confirmation") return { status: "not_pending" };
    const checkedAt = input.checkedAt ?? new Date();
    if (
      checkedAt.getTime() - current.pendingChangeRequestedAt.getTime() <
      PLAN_CHANGE_CONFIRMATION_TIMEOUT_MS
    ) {
      return { status: "waiting" };
    }
    const released = await this.autoRenewRepository.releasePlanChangeReservation({
      id: current.id,
      pendingChangeRequestedAt: current.pendingChangeRequestedAt,
      metadata: mergeMetadata(current.metadata, {
        planChangeRecovery: {
          reason: "provider_not_confirmed_after_reconcile",
          targetProductCode: current.pendingProductCode,
          provider: current.provider,
          recoveredAt: checkedAt.toISOString(),
        },
      }),
    });
    if (released && this.systemEventLogRepository) {
      await this.systemEventLogRepository.create({
        userId: current.userId,
        module: "payment",
        event: "payment.autorenew.plan_change_recovered",
        level: "warn",
        status: "success",
        errorCode: "AUTO_RENEW_PLAN_CHANGE_CONFIRMATION_EXPIRED",
        metadata: {
          provider: current.provider,
          autoRenewSubscriptionId: current.id,
          targetProductCode: current.pendingProductCode,
          requestedAt: current.pendingChangeRequestedAt.toISOString(),
          recoveredAt: checkedAt.toISOString(),
        },
      }).catch(() => undefined);
    }
    return released
      ? { status: "released", subscriptionId: current.id }
      : { status: "not_pending" };
  }

  async reconcileRevertedScheduledPlanChange(input: {
    provider: AutoRenewProvider;
    providerAgreementId: string;
    observedCurrentProductCode: AutoRenewProductCode;
    rawPayload?: unknown;
    reconciledAt?: Date;
  }): Promise<{ status: "not_scheduled" | "retained" | "cleared" }> {
    const current = await this.autoRenewRepository.findByProviderAgreement({
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });
    if (
      !current?.pendingProductCode ||
      current.pendingChangeStatus !== "scheduled"
    ) {
      return { status: "not_scheduled" };
    }
    // Only clear when the provider explicitly reports renewal staying on the
    // currently active product. A different product is handled as provider
    // truth by the normal paid/scheduled notification paths.
    if (input.observedCurrentProductCode !== current.productCode) {
      return { status: "retained" };
    }
    const reconciledAt = input.reconciledAt ?? new Date();
    const targetProductCode = current.pendingProductCode;
    const cleared = await this.autoRenewRepository.clearScheduledPlanChange({
      id: current.id,
      pendingProductCode: targetProductCode,
      metadata: mergeMetadata(current.metadata, {
        planChangeRecovery: {
          reason: "provider_reverted_to_current_plan",
          provider: current.provider,
          targetProductCode,
          recoveredAt: reconciledAt.toISOString(),
          providerPayload: input.rawPayload ?? null,
        },
      }),
    });
    if (cleared && this.systemEventLogRepository) {
      await this.systemEventLogRepository.create({
        userId: current.userId,
        module: "payment",
        event: "payment.autorenew.scheduled_plan_change_reverted",
        level: "info",
        status: "success",
        metadata: {
          provider: current.provider,
          autoRenewSubscriptionId: current.id,
          currentProductCode: current.productCode,
          revertedTargetProductCode: targetProductCode,
          recoveredAt: reconciledAt.toISOString(),
        },
      }).catch(() => undefined);
    }
    return { status: cleared ? "cleared" : "not_scheduled" };
  }

  async confirmScheduledPlanChange(input: {
    provider: AutoRenewProvider;
    providerAgreementId: string;
    targetProductCode: AutoRenewProductCode;
    effectiveAt?: Date | null;
    rawPayload?: unknown;
  }): Promise<{ status: "processed" | "ignored" }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });
    if (!subscription) return { status: "ignored" };
    if (subscription.productCode === input.targetProductCode) return { status: "ignored" };
    if (
      !["active", "billing_retry"].includes(subscription.status) ||
      readBooleanMetadata(subscription.metadata, "cancelAtPeriodEnd")
    ) {
      return { status: "ignored" };
    }
    await this.autoRenewRepository.updateSubscription({
      id: subscription.id,
      pendingProductCode: input.targetProductCode,
      pendingChangeStatus: "scheduled",
      pendingChangeEffectiveAt: input.effectiveAt ?? subscription.currentPeriodEnd,
      pendingChangeRequestedAt: subscription.pendingChangeRequestedAt ?? new Date(),
      metadata: mergeMetadata(subscription.metadata, {
        planChangeProviderConfirmation: input.rawPayload ?? null,
      }),
    });
    return { status: "processed" };
  }

  async replaceGooglePlayPurchaseToken(input: {
    userId: string;
    linkedPurchaseToken: string;
    purchaseToken: string;
  }): Promise<AutoRenewSubscriptionEntity | null> {
    if (input.linkedPurchaseToken === input.purchaseToken) return null;
    const replacement = await this.getGooglePlaySubscriptionByPurchaseToken(input.purchaseToken);
    if (replacement) {
      if (replacement.userId !== input.userId) throw new AutoRenewAccessDeniedError();
      return replacement;
    }
    const previous = await this.getGooglePlaySubscriptionByPurchaseToken(input.linkedPurchaseToken);
    if (!previous) return null;
    if (previous.userId !== input.userId) throw new AutoRenewAccessDeniedError();
    return this.autoRenewRepository.updateSubscription({
      id: previous.id,
      providerAgreementId: input.purchaseToken,
      metadata: mergeMetadata(previous.metadata, {
        googlePlayReplacedPurchaseToken: input.linkedPurchaseToken,
        googlePlayReplacementAppliedAt: new Date().toISOString(),
      }),
    });
  }

  async cancel(input: {
    userId: string;
    autoRenewSubscriptionId: string;
    cancelledAt?: Date;
    metadata?: unknown;
  }): Promise<AutoRenewSubscriptionEntity> {
    const current = await this.autoRenewRepository.findActiveByUserId(input.userId);
    if (!current) throw new AutoRenewNotFoundError();
    if (current.id !== input.autoRenewSubscriptionId) throw new AutoRenewAccessDeniedError();

    return this.autoRenewRepository.cancelSubscription({
      id: current.id,
      cancelledAt: input.cancelledAt ?? new Date(),
      metadata: input.metadata,
    });
  }

  async cancelWithProvider(input: {
    userId: string;
    autoRenewSubscriptionId: string;
  }): Promise<AutoRenewSubscriptionEntity> {
    return this.cancel({ userId: input.userId, autoRenewSubscriptionId: input.autoRenewSubscriptionId,
      metadata: { cancelSource: "local", cancelledAt: new Date().toISOString() } });
  }

  async updateProviderRenewalPreference(input: {
    provider: AutoRenewProvider;
    providerAgreementId: string;
    cancelAtPeriodEnd: boolean;
    rawPayload?: unknown;
  }): Promise<{ status: "processed" | "ignored" }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });
    if (!subscription) return { status: "ignored" };

    const periodIsCurrent = Boolean(
      subscription.currentPeriodEnd && subscription.currentPeriodEnd > new Date()
    );
    if (["cancelled", "expired"].includes(subscription.status) && !periodIsCurrent) {
      return { status: "ignored" };
    }

    await this.autoRenewRepository.updateSubscription({
      id: subscription.id,
      ...(periodIsCurrent
        ? { status: "active" as const, cancelledAt: null, allowReactivation: true }
        : {}),
      ...(input.cancelAtPeriodEnd
        ? {
            pendingProductCode: null,
            pendingChangeStatus: null,
            pendingChangeEffectiveAt: null,
            pendingChangeRequestedAt: null,
          }
        : {}),
      metadata: mergeMetadata(subscription.metadata, {
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        renewalPreferenceUpdatedAt: new Date().toISOString(),
        renewalPreferenceSource: input.provider,
        renewalPreferencePayload: input.rawPayload ?? null,
      }),
    });
    return { status: "processed" };
  }

  async handleApplePaidTransaction(input: {
    originalTransactionId: string;
    transactionId: string;
    productCode?: AutoRenewProductCode;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    rawPayload?: unknown;
  }): Promise<{ status: "processed" | "ignored"; userId: string | null }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: "apple",
      providerAgreementId: input.originalTransactionId,
    });
    if (!subscription) return { status: "ignored", userId: null };
    // Provider notifications can be delayed or replayed out of order. Reject an
    // older period before recordPaidCharge grants it or supersedes the current
    // provider entitlement.
    if (isStalePaidPeriod(subscription, {
      productCode: input.productCode ?? subscription.productCode,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    })) {
      return { status: "processed", userId: subscription.userId };
    }
    await this.recordPaidCharge({
      userId: subscription.userId,
      provider: "apple",
      productCode: input.productCode ?? subscription.productCode,
      providerAgreementId: input.originalTransactionId,
      providerChargeId: input.transactionId,
      periodKey: input.transactionId,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      paidAt: input.periodStart ?? new Date(),
      rawPayload: input.rawPayload ?? null,
    });
    await this.autoRenewRepository.updateSubscription({
      id: subscription.id,
      ...appliedProductFields(subscription, input.productCode ?? subscription.productCode),
      status: "active",
      latestTransactionId: input.transactionId,
      currentPeriodStart: input.periodStart ?? subscription.currentPeriodStart,
      currentPeriodEnd: input.periodEnd ?? subscription.currentPeriodEnd,
      nextBillingAt: input.periodEnd ? computeEarlyBillingAt(input.periodEnd) : subscription.nextBillingAt,
      cancelledAt: null,
      allowReactivation: true,
    });

    return { status: "processed", userId: subscription.userId };
  }

  async handleAppleCancelled(input: {
    originalTransactionId: string;
    rawPayload?: unknown;
  }): Promise<{ status: "processed" | "ignored" }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: "apple",
      providerAgreementId: input.originalTransactionId,
    });
    if (!subscription) return { status: "ignored" };
    if (subscription.status === "cancelled") return { status: "ignored" };

    // Apple 退款/过期通知只取消后续自动续费关系；是否回收当前权益由 Subscription 层单独决定。
    await this.autoRenewRepository.cancelSubscription({
      id: subscription.id,
      cancelledAt: new Date(),
      metadata: mergeMetadata(subscription.metadata, {
        appleCancel: input.rawPayload ?? null,
      }),
    });
    return { status: "processed" };
  }

  async handleGooglePlayPaidTransaction(input: {
    purchaseToken: string;
    providerChargeId: string;
    productCode?: AutoRenewProductCode;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    rawPayload?: unknown;
  }): Promise<{ status: "processed" | "ignored"; userId: string | null }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: "google_play",
      providerAgreementId: input.purchaseToken,
    });
    if (!subscription) return { status: "ignored", userId: null };
    if (isStalePaidPeriod(subscription, {
      productCode: input.productCode ?? subscription.productCode,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    })) {
      return { status: "processed", userId: subscription.userId };
    }
    await this.recordPaidCharge({
      userId: subscription.userId,
      provider: "google_play",
      productCode: input.productCode ?? subscription.productCode,
      providerAgreementId: input.purchaseToken,
      providerChargeId: input.providerChargeId,
      periodKey: input.providerChargeId,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      paidAt: input.periodStart ?? new Date(),
      rawPayload: input.rawPayload ?? null,
    });
    await this.autoRenewRepository.updateSubscription({
      id: subscription.id,
      ...appliedProductFields(subscription, input.productCode ?? subscription.productCode),
      status: "active",
      latestTransactionId: input.providerChargeId,
      currentPeriodStart: input.periodStart ?? subscription.currentPeriodStart,
      currentPeriodEnd: input.periodEnd ?? subscription.currentPeriodEnd,
      nextBillingAt: input.periodEnd ? computeEarlyBillingAt(input.periodEnd) : subscription.nextBillingAt,
      cancelledAt: null,
      allowReactivation: true,
      metadata: mergeMetadata(subscription.metadata, {
        googlePlayPaid: input.rawPayload ?? null,
      }),
    });

    return { status: "processed", userId: subscription.userId };
  }

  async handleGooglePlayCancelled(input: {
    purchaseToken: string;
    rawPayload?: unknown;
  }): Promise<{ status: "processed" | "ignored" }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: "google_play",
      providerAgreementId: input.purchaseToken,
    });
    if (!subscription) return { status: "ignored" };
    if (subscription.status === "cancelled") return { status: "ignored" };

    await this.autoRenewRepository.cancelSubscription({
      id: subscription.id,
      cancelledAt: new Date(),
      metadata: mergeMetadata(subscription.metadata, {
        googlePlayCancel: input.rawPayload ?? null,
      }),
    });
    return { status: "processed" };
  }

  async recordPaidCharge(input: RecordPaidChargeInput): Promise<{
    charge: AutoRenewChargeEntity;
    alreadyApplied: boolean;
  }> {
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: input.provider,
      providerAgreementId: input.providerAgreementId,
    });

    if (!subscription) throw new AutoRenewNotFoundError();
    if (subscription.userId !== input.userId) throw new AutoRenewAccessDeniedError();

    const paidAt = input.paidAt ?? new Date();
    const productCode = input.productCode ?? subscription.productCode;
    const replacedSourceOrderId = productCode !== subscription.productCode
      && subscription.latestTransactionId
      && subscription.latestTransactionId !== input.providerChargeId
      ? createAutoRenewEntitlementSourceOrderId(input.provider, subscription.latestTransactionId)
      : null;
    const charge = await this.autoRenewRepository.upsertCharge({
      autoRenewSubscriptionId: subscription.id,
      userId: input.userId,
      provider: input.provider,
      productCode,
      providerChargeId: input.providerChargeId,
      periodKey: input.periodKey ?? input.providerChargeId,
      status: "paid",
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      paidAt,
      rawPayload: input.rawPayload ?? null,
    });

    const result = await this.paymentEntitlementService.grantAfterPayment({
      userId: input.userId,
      sourceOrderId: createAutoRenewEntitlementSourceOrderId(input.provider, input.providerChargeId),
      productCode,
      channel: input.provider === "apple" ? "ios_iap" : input.provider === "google_play" ? "android_iap" : input.provider === "alipay" ? "alipay" : "wechat",
      grantMode: "subscription_period",
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      prepaidLimit: "skip",
    });

    // A provider-confirmed plan replacement terminates the previous paid
    // period. Grant first, then revoke the replaced provider grant: if the
    // process stops between the two operations, replay remains idempotent and
    // completes the cleanup without risking a paid-user entitlement gap.
    if (replacedSourceOrderId && this.subscriptionService) {
      await this.subscriptionService.supersedePaymentGrant({
        sourceOrderId: replacedSourceOrderId,
        provider: input.provider,
        supersededAt: input.periodStart ?? paidAt,
      });
    }

    return {
      charge,
      alreadyApplied: result.alreadyApplied,
    };
  }

  private async assertCanCreateAfterCancellation(input: {
    userId: string;
    provider: AutoRenewProvider;
    providerAgreementId?: string;
  }): Promise<void> {
    if (!this.subscriptionService) return;
    // 这里专门处理“取消自动续费后立刻换渠道重签”的边界：
    // findActiveByUserId 查不到 cancelled，所以必须看最近一条自动续费记录。
    const latest = await this.autoRenewRepository.findLatestByUserId(input.userId);
    if (!latest || latest.status !== "cancelled" || !latest.latestTransactionId) return;
    if (
      latest.provider === input.provider &&
      latest.providerAgreementId === input.providerAgreementId
    ) {
      return;
    }

    const now = new Date();
    const currentMembership = await this.subscriptionService.getCurrentSubscription(input.userId, now);
    if (!currentMembership.isMember || !currentMembership.expiresAt || currentMembership.expiresAt <= now) return;

    // 取消自动续费只是不再续扣，不代表当前已付费会员立即失效。
    // 在这段权益还没结束前，不允许马上换到另一个渠道重新签约，避免同时留下两套平台协议。
    throw new AutoRenewSwitchBlockedError({
      provider: latest.provider,
      currentPeriodEnd: currentMembership.expiresAt,
    });
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function mergeMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  return { ...base, ...patch };
}

function readBooleanMetadata(metadata: unknown, key: string): boolean {
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[key] === true
  );
}

function appliedProductFields(
  subscription: AutoRenewSubscriptionEntity | null,
  productCode: AutoRenewProductCode
) {
  if (subscription?.pendingProductCode && subscription.pendingProductCode !== productCode) {
    // A renewal/verification for the still-current plan may arrive while a
    // downgrade or duration change is waiting for the next period.
    return { productCode } as const;
  }
  return {
    productCode,
    pendingProductCode: null,
    pendingChangeStatus: null,
    pendingChangeEffectiveAt: null,
    pendingChangeRequestedAt: null,
  } as const;
}

function isTierUpgrade(current: AutoRenewProductCode, target: AutoRenewProductCode): boolean {
  return current.startsWith("plus_") && target.startsWith("pro_");
}

function isStalePaidPeriod(
  subscription: AutoRenewSubscriptionEntity,
  incoming: {
    productCode: AutoRenewProductCode;
    periodStart: Date | null;
    periodEnd: Date | null;
  }
): boolean {
  if (!incoming.periodEnd || !subscription.currentPeriodEnd) return false;
  if (incoming.periodEnd < subscription.currentPeriodEnd) return true;
  if (incoming.periodEnd > subscription.currentPeriodEnd) return false;
  if (incoming.productCode === subscription.productCode) return false;
  if (subscription.pendingProductCode === incoming.productCode) return false;
  if (!incoming.periodStart || !subscription.currentPeriodStart) return true;
  return incoming.periodStart <= subscription.currentPeriodStart;
}

export function createAutoRenewEntitlementSourceOrderId(
  provider: AutoRenewProvider,
  providerChargeId: string
): string {
  if (provider === "apple") return `apple_iap:${providerChargeId}`;
  if (provider === "google_play") return `google_play_iap:${providerChargeId}`;
  return `${provider}_autorenew:${providerChargeId}`;
}
