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
      if (
        input.provider === "apple" &&
        input.status === "active" &&
        (input.latestTransactionId || input.currentPeriodEnd)
      ) {
        return this.autoRenewRepository.updateSubscription({
          id: existing.id,
          userId: input.userId,
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
    const existingCharge = await this.autoRenewRepository.findChargeByProviderCharge({
      provider: "apple",
      providerChargeId: input.transactionId,
    });
    if (existingCharge?.status === "paid") {
      // Apple server notification 也可能重复投递，同一 transactionId 只发一次权益。
      return { status: "ignored", userId: subscription.userId };
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

function computeEarlyBillingAt(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() - 172_800_000);
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

export function createAutoRenewEntitlementSourceOrderId(
  provider: AutoRenewProvider,
  providerChargeId: string
): string {
  if (provider === "apple") return `apple_iap:${providerChargeId}`;
  if (provider === "google_play") return `google_play_iap:${providerChargeId}`;
  return `${provider}_autorenew:${providerChargeId}`;
}
