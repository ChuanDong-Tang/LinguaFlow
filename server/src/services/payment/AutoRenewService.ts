import type {
  AutoRenewChargeEntity,
  AutoRenewProvider,
  AutoRenewRepository,
  AutoRenewSubscriptionEntity,
} from "@lf/core/ports/repository/AutoRenewRepository.js";
import type { WeChatAppPayParams } from "@lf/core/ports/payment/PaymentTypes.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { PaymentEntitlementService } from "./PaymentEntitlementService.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import type {
  WeChatAutoRenewProvider,
  WeChatContractNotification,
  WeChatDebitNotification,
} from "../../providers/payment/wechat/WeChatAutoRenewProvider.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { addCalendarMonthsClamped } from "../time/calendarMath.js";
import { ProRenewalTooEarlyError } from "./ProPrepaidLimit.js";
import { createHash } from "node:crypto";

export interface CurrentAutoRenewView {
  subscription: AutoRenewSubscriptionEntity | null;
}

export interface CreateWeChatPreSignResult {
  subscription: AutoRenewSubscriptionEntity;
  outContractCode: string;
  providerOrderId: string | null;
  clientPayParams: WeChatAppPayParams | null;
  redirectUrl: string | null;
}

export interface RegisterAutoRenewInput {
  userId: string;
  provider: AutoRenewProvider;
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
    super("Cannot switch auto renew provider while current Pro period is still active");
    this.provider = input.provider;
    this.currentPeriodEnd = input.currentPeriodEnd;
  }
}

export class AutoRenewService {
  constructor(
    private readonly autoRenewRepository: AutoRenewRepository,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly weChatAutoRenewProvider?: WeChatAutoRenewProvider,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly subscriptionService?: SubscriptionService
  ) {}

  async getCurrent(userId: string): Promise<CurrentAutoRenewView> {
    return {
      // 自动续费状态按 userId 查，而不是按设备/渠道查。
      // 这样用户在微信开通后，用 iOS 登录也能看到“已通过微信开通”，避免双端重复签约。
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

  async isUserProActive(userId: string, now = new Date()): Promise<boolean> {
    if (!this.subscriptionService) return false;
    const currentPro = await this.subscriptionService.getCurrentSubscription(userId, now);
    return Boolean(currentPro.isPro && currentPro.expiresAt && currentPro.expiresAt > now);
  }

  async transferAppleSubscriptionToUser(input: {
    subscriptionId: string;
    userId: string;
    latestTransactionId: string;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    metadata?: unknown;
  }): Promise<AutoRenewSubscriptionEntity> {
    return this.autoRenewRepository.updateSubscription({
      id: input.subscriptionId,
      userId: input.userId,
      status: "active",
      latestTransactionId: input.latestTransactionId,
      currentPeriodStart: input.periodStart ?? null,
      currentPeriodEnd: input.periodEnd ?? null,
      nextBillingAt: input.periodEnd ? computeEarlyBillingAt(input.periodEnd) : null,
      metadata: input.metadata,
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
      // 同一个用户已在微信/Apple 任一渠道开通时，另一端只能展示状态，不能再开第二份自动续费。
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

    if (existing) return existing;

    try {
      return await this.autoRenewRepository.createSubscription({
        userId: input.userId,
        provider: input.provider,
        productCode: "pro_monthly",
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

  async createWeChatPreSign(input: {
    userId: string;
  }): Promise<CreateWeChatPreSignResult> {
    if (!this.weChatAutoRenewProvider) {
      throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
    }
    const runtime = getRuntimeConfig();
    if (!runtime.payment.wechatAutoRenew.enabled) {
      throw new Error("WECHAT_AUTORENEW_DISABLED");
    }
    const now = new Date();

    const activeForUser = await this.autoRenewRepository.findActiveByUserId(input.userId);
    if (activeForUser) {
      // 已经真的开通了自动续费，才拦住。
      throw new AutoRenewAlreadyActiveError(activeForUser.provider);
    }

    const pendingForUser = await this.autoRenewRepository.findPendingByUserId(input.userId);
    if (pendingForUser && !pendingForUser.latestTransactionId) {
      // 上一次只是预创建，还没有拿到微信 contract_id，说明用户可能取消/关闭/中断了。
      // 不要让它锁住用户，直接废弃旧 pending，允许重新预签约。
      await this.autoRenewRepository.cancelSubscription({
        id: pendingForUser.id,
        cancelledAt: now,
        metadata: mergeMetadata(pendingForUser.metadata, {
          cancelSource: "replace_unfinished_pre_sign",
          cancelledAt: now.toISOString(),
        }),
      });
    }

    await this.assertCanCreateAfterCancellation({
      userId: input.userId,
      provider: "wechat",
    }); 

    const currentPro = await this.subscriptionService?.getCurrentSubscription(input.userId, now);
    const activePro =
      currentPro?.isPro === true && currentPro.expiresAt && currentPro.expiresAt > now
        ? currentPro
        : null;
    if (activePro?.expiresAt) {
      // 已有有效 Pro 时不再创建新的自动续费签约，避免“还在 Pro 期间又签一笔首期扣款”。
      throw new ProRenewalTooEarlyError({ expiresAt: activePro.expiresAt });
    }

    const preSign = await this.weChatAutoRenewProvider.createH5PreSign({
      userId: input.userId,
      productCode: "pro_monthly",
      description: runtime.payment.wechatAutoRenew.chargeDescription,
      amount: runtime.payment.proMonthlyPriceCents,
      currency: "CNY",
    });
    // 这里先用 out_contract_code 作为 providerAgreementId。
    // 微信 contract_id 要等签约回调回来后才会写入 latestTransactionId。
    const subscription = await this.register({
      userId: input.userId,
      provider: "wechat",
      providerAgreementId: preSign.outContractCode,
      status: "pending",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingAt: null,
      metadata: {
        source: "wechat_v3_app_with_contract",
        firstChargeMode: "charge_after_contract_active",
        preSignRaw: preSign.raw,
      },
    });

    const periodStart = new Date();
    const periodEnd = addCalendarMonthsClamped(periodStart, 1);
    // App-with-contract 的首期支付单也先落库，后续支付/签约回调才能用 out_trade_no 幂等发权益。
    await this.autoRenewRepository.upsertCharge({
      autoRenewSubscriptionId: subscription.id,
      userId: input.userId,
      provider: "wechat",
      productCode: "pro_monthly",
      providerChargeId: preSign.outTradeNo,
      periodKey: "initial",
      status: "pending",
      amount: runtime.payment.proMonthlyPriceCents,
      currency: "CNY",
      periodStart,
      periodEnd,
      rawPayload: { source: "wechat_v3_app_with_contract", stage: "prepay_created", raw: preSign.raw },
    });

    return {
      subscription,
      outContractCode: preSign.outContractCode,
      providerOrderId: preSign.outTradeNo,
      clientPayParams: preSign.clientPayParams,
      redirectUrl: null,
    };
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
    const current = await this.autoRenewRepository.findActiveByUserId(input.userId);
    if (!current) {
      const pending = await this.autoRenewRepository.findPendingByUserId(input.userId);
      if (
        pending &&
        pending.id === input.autoRenewSubscriptionId &&
        !pending.latestTransactionId
      ) {
        const cancelledAt = new Date();
        // 用户在微信签约/首扣前取消时，服务端只有预创建记录，没有平台 contract_id。
        // 这里只废弃本地 pending，不能调用微信解约接口。
        return this.autoRenewRepository.cancelSubscription({
          id: pending.id,
          cancelledAt,
          metadata: mergeMetadata(pending.metadata, {
            cancelSource: "unfinished_pre_sign",
            cancelledAt: cancelledAt.toISOString(),
          }),
        });
      }

      throw new AutoRenewNotFoundError();
    }
    if (current.id !== input.autoRenewSubscriptionId) throw new AutoRenewAccessDeniedError();

    if (current.provider === "wechat" && current.latestTransactionId) {
      if (!this.weChatAutoRenewProvider) throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
      await this.weChatAutoRenewProvider.cancelContract({
        outContractCode: current.providerAgreementId,
        contractId: current.latestTransactionId,
        reason: "用户主动取消自动续费",
      });
    }

    return this.cancel({
      userId: input.userId,
      autoRenewSubscriptionId: input.autoRenewSubscriptionId,
      metadata: mergeMetadata(current.metadata, {
        cancelSource: "provider_api",
        cancelledAt: new Date().toISOString(),
      }),
    });
  }

  async handleWeChatContractNotification(
    notification: WeChatContractNotification
  ): Promise<AutoRenewSubscriptionEntity> {
    if (!notification.outContractCode) throw new Error("WECHAT_CONTRACT_NOTIFY_MISSING_CODE");
    const subscription = await this.autoRenewRepository.findByProviderAgreement({
      provider: "wechat",
      providerAgreementId: notification.outContractCode,
    });
    if (!subscription) throw new AutoRenewNotFoundError();

    const normalizedState = String(notification.contractState ?? "").toUpperCase();
    const status =
      normalizedState.includes("TERMINATED") || normalizedState.includes("CANCEL")
        ? "cancelled"
        : "active";
    if (subscription.status === "cancelled" && status === "active") {
      // 取消后的旧签约通知可能延迟到达，不能把用户已经取消的自动续费重新激活。
      return subscription;
    }

    const updated = await this.autoRenewRepository.updateSubscription({
      id: subscription.id,
      status,
      latestTransactionId: notification.contractId ?? subscription.latestTransactionId,
      metadata: mergeMetadata(subscription.metadata, {
        wechatContract: {
          eventType: notification.eventType,
          contractState: notification.contractState,
          contractId: notification.contractId,
          raw: notification.raw,
        },
      }),
    });

    if (status === "active" && updated.latestTransactionId && !updated.currentPeriodEnd) {
      // H5 纯预签约兜底路径：只有没有首期支付单的旧链路，才在签约成功后补提首期扣款。
      // 新的 App-with-contract 链路会在用户支付首期时同时签约，不能在签约回调里再扣一笔。
      const initialCharge = await this.autoRenewRepository.findChargeByPeriod({
        autoRenewSubscriptionId: updated.id,
        periodKey: "initial",
      });
      if (!initialCharge) {
        await this.submitInitialWeChatCharge(updated);
      }
    }
    if (status === "active" && !updated.latestTransactionId) {
      await this.writeSystemEventLog({
        userId: updated.userId,
        event: "payment.autorenew.wechat.contract_missing_id",
        level: "error",
        errorCode: "WECHAT_AUTORENEW_CONTRACT_ID_MISSING",
        errorMessage: "WeChat contract notification became active without contract id",
        metadata: {
          autoRenewSubscriptionId: updated.id,
          providerAgreementId: updated.providerAgreementId,
          eventType: notification.eventType,
          contractState: notification.contractState,
        },
      });
    }

    return updated;
  }

  async handleWeChatContractRawNotify(rawBody: string): Promise<AutoRenewSubscriptionEntity> {
    if (!this.weChatAutoRenewProvider) throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
    return this.handleWeChatContractNotification(
      this.weChatAutoRenewProvider.parseContractNotification(rawBody)
    );
  }

  async handleWeChatDebitNotification(notification: WeChatDebitNotification): Promise<{
    chargeId: string | null;
    status: "processed" | "ignored";
  }> {
    if (!notification.contractId) throw new Error("WECHAT_DEBIT_NOTIFY_MISSING_CONTRACT_ID");
    const subscription = await this.autoRenewRepository.findByLatestTransaction({
      provider: "wechat",
      latestTransactionId: notification.contractId,
    });
    if (!subscription) throw new AutoRenewNotFoundError();
    if (subscription.status === "cancelled") {
      // 用户取消后，历史扣款回调仍可能晚到；只记录/忽略，不再推进下一期自动续费。
      return { chargeId: notification.outTradeNo, status: "ignored" };
    }
    const existingCharge = await this.autoRenewRepository.findChargeByProviderCharge({
      provider: "wechat",
      providerChargeId: notification.outTradeNo,
    });
    if (existingCharge?.status === "paid") {
      // 微信回调可能重复投递，已 paid 的 charge 不能再次推进 currentPeriodEnd。
      return { chargeId: notification.outTradeNo, status: "ignored" };
    }
    assertWeChatDebitAmountMatches({
      expectedAmount: existingCharge?.amount ?? getRuntimeConfig().payment.proMonthlyPriceCents,
      expectedCurrency: existingCharge?.currency ?? "CNY",
      actualAmount: notification.amount,
      actualCurrency: notification.currency,
    });

    const success =
      notification.eventType === "TRANSACTION.SUCCESS" ||
      String(notification.tradeState ?? "").toUpperCase() === "SUCCESS";
    if (!success) {
      const retryAt = computeRetryBillingAt(subscription.currentPeriodEnd, new Date());
      await this.autoRenewRepository.upsertCharge({
        autoRenewSubscriptionId: subscription.id,
        userId: subscription.userId,
        provider: "wechat",
        productCode: "pro_monthly",
        providerChargeId: notification.outTradeNo,
        periodKey: notification.outTradeNo,
        status: "failed",
        failedAt: new Date(),
        rawPayload: notification.raw,
      });
      await this.autoRenewRepository.updateSubscription({
        id: subscription.id,
        status: "billing_retry",
        // 失败重试不能被推到当前权益周期之后太久；这里取“6小时后”和“到期前”中较早的时间。
        nextBillingAt: retryAt,
      });
      await this.writeSystemEventLog({
        userId: subscription.userId,
        event: "payment.autorenew.wechat.debit_failed",
        level: "warn",
        errorCode: "WECHAT_AUTORENEW_DEBIT_FAILED",
        errorMessage: String(notification.tradeState ?? notification.eventType ?? "unknown"),
        metadata: {
          autoRenewSubscriptionId: subscription.id,
          providerChargeId: notification.outTradeNo,
          contractId: notification.contractId,
          retryAt: retryAt.toISOString(),
        },
      });
      return { chargeId: notification.outTradeNo, status: "processed" };
    }

    const periodStart = existingCharge?.periodStart ?? subscription.currentPeriodEnd ?? new Date();
    const periodEnd = existingCharge?.periodEnd ?? addCalendarMonthsClamped(periodStart, 1);
    await this.recordPaidCharge({
      userId: subscription.userId,
      provider: "wechat",
      providerAgreementId: subscription.providerAgreementId,
      providerChargeId: notification.outTradeNo,
      periodKey: notification.outTradeNo,
      // 关键边界：提前两天申请续扣/扣款成功，也不能让新权益提前生效。
      // 新周期必须从旧 currentPeriodEnd 接上，避免扣款早到后把权益边界提前滚动。
      periodStart,
      periodEnd,
      amount: notification.amount ?? existingCharge?.amount ?? null,
      currency: notification.currency ?? existingCharge?.currency ?? null,
      paidAt: new Date(),
      rawPayload: notification.raw,
    });
    await this.autoRenewRepository.updateSubscription({
      id: subscription.id,
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextBillingAt: computeEarlyBillingAt(periodEnd),
      metadata: mergeMetadata(subscription.metadata, {
        lastWechatDebit: {
          outTradeNo: notification.outTradeNo,
          transactionId: notification.transactionId,
          eventType: notification.eventType,
        },
      }),
    });
    return { chargeId: notification.outTradeNo, status: "processed" };
  }

  async handleWeChatDebitRawNotify(rawBody: string): Promise<{
    chargeId: string | null;
    status: "processed" | "ignored";
  }> {
    if (!this.weChatAutoRenewProvider) throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
    return this.handleWeChatDebitNotification(this.weChatAutoRenewProvider.parseDebitNotification(rawBody));
  }

  async handleApplePaidTransaction(input: {
    originalTransactionId: string;
    transactionId: string;
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

  async runDueWeChatBilling(input: {
    limit?: number;
    now?: Date;
  } = {}): Promise<{ scanned: number; submitted: number; failed: number }> {
    if (!this.weChatAutoRenewProvider) {
      throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
    }
    const runtime = getRuntimeConfig();
    const now = input.now ?? new Date();
    // 每轮 worker 先对账，再预约/扣款。
    // 这样可以补偿“微信扣款已成功但回调丢失/延迟”的情况，避免用户付了钱却没续上权益。
    await this.reconcilePendingWeChatCharges({
      now,
      limit: input.limit ?? runtime.payment.wechatAutoRenew.batchSize,
    });
    const subscriptions = await this.autoRenewRepository.listDueForBilling({
      now,
      limit: input.limit ?? runtime.payment.wechatAutoRenew.batchSize,
    });
    const result = { scanned: subscriptions.length, submitted: 0, failed: 0 };

    for (const subscription of subscriptions) {
      try {
        if (!subscription.latestTransactionId) {
          const retryAt = computeRetryBillingAt(subscription.currentPeriodEnd, now);
          await this.autoRenewRepository.updateSubscription({
            id: subscription.id,
            status: "billing_retry",
            nextBillingAt: retryAt,
            metadata: mergeMetadata(subscription.metadata, {
              lastBillingError: "missing_wechat_contract_id",
            }),
          });
          await this.writeSystemEventLog({
            userId: subscription.userId,
            event: "payment.autorenew.wechat.billing_missing_contract",
            level: "warn",
            errorCode: "WECHAT_AUTORENEW_MISSING_CONTRACT_ID",
            errorMessage: "Missing WeChat contract id before auto renew billing",
            metadata: {
              autoRenewSubscriptionId: subscription.id,
              providerAgreementId: subscription.providerAgreementId,
              retryAt: retryAt.toISOString(),
            },
          });
          result.failed += 1;
          continue;
        }
        if (!subscription.currentPeriodEnd) {
          // 还没有首期权益边界，说明签约后的首期扣款尚未确认成功。
          // 这时 worker 只能补提/重试首期扣款，不能误判成“下一期续费”再扣一次。
          const submitted = await this.submitInitialWeChatCharge(subscription);
          if (submitted) result.submitted += 1;
          continue;
        }
        // currentPeriodEnd 是权益回收/续接边界；nextBillingAt 是续扣触发时间。
        // 微信 V3 扣费服务由商户在续费窗口主动受理扣款；成功仍以验签后的通知/查单结果为准。
        const periodStart = subscription.currentPeriodEnd ?? now;
        const periodEnd = addCalendarMonthsClamped(periodStart, 1);
        const periodKey = toPeriodKey(periodStart, periodEnd);
        const outTradeNo = createWechatAutoRenewTradeNo(subscription.id, periodKey);
        const existingCharge = await this.autoRenewRepository.findChargeByPeriod({
          autoRenewSubscriptionId: subscription.id,
          periodKey,
        });
        if (existingCharge?.status === "paid" || existingCharge?.status === "pending") {
          continue;
        }

        // 先落本期 charge，再调用微信。periodKey 是同周期幂等护栏，避免 worker 重启或并发扫描导致重复扣款。
        await this.autoRenewRepository.upsertCharge({
          autoRenewSubscriptionId: subscription.id,
          userId: subscription.userId,
          provider: "wechat",
          productCode: "pro_monthly",
          providerChargeId: outTradeNo,
          periodKey,
          status: "pending",
          amount: runtime.payment.proMonthlyPriceCents,
          currency: "CNY",
          periodStart,
          periodEnd,
          rawPayload: { source: "wechat_autorenew_worker", stage: "before_provider_call" },
        });

        // 微信 V3 扣费服务需要商户主动受理本期续扣；成功权益以验签后的异步通知/查单结果为准。
        // applyDeduct 返回成功只表示“微信已受理扣款请求”，不等于扣款成功，更不能在这里直接续 Pro。
        await this.weChatAutoRenewProvider.applyDeduct({
          contractId: subscription.latestTransactionId,
          outTradeNo,
          description: runtime.payment.wechatAutoRenew.chargeDescription,
          amount: runtime.payment.proMonthlyPriceCents,
          currency: "CNY",
        });
        await this.autoRenewRepository.upsertCharge({
          autoRenewSubscriptionId: subscription.id,
          userId: subscription.userId,
          provider: "wechat",
          productCode: "pro_monthly",
          providerChargeId: outTradeNo,
          periodKey,
          status: "pending",
          amount: runtime.payment.proMonthlyPriceCents,
          currency: "CNY",
          periodStart,
          periodEnd,
          rawPayload: { source: "wechat_autorenew_worker", stage: "provider_call_accepted" },
        });
        await this.autoRenewRepository.updateSubscription({
          id: subscription.id,
          status: "active",
          nextBillingAt: addHours(now, 12),
        });
        result.submitted += 1;
      } catch (error) {
        result.failed += 1;
        const retryAt = computeRetryBillingAt(subscription.currentPeriodEnd, now);
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.autoRenewRepository.updateSubscription({
          id: subscription.id,
          status: "billing_retry",
          nextBillingAt: retryAt,
          metadata: mergeMetadata(subscription.metadata, {
            lastBillingError: errorMessage,
          }),
        });
        await this.writeSystemEventLog({
          userId: subscription.userId,
          event: "payment.autorenew.wechat.billing_item_failed",
          level: "error",
          errorCode: "WECHAT_AUTORENEW_BILLING_ITEM_FAILED",
          errorMessage,
          metadata: {
            autoRenewSubscriptionId: subscription.id,
            providerAgreementId: subscription.providerAgreementId,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
            nextBillingAt: retryAt.toISOString(),
          },
        });
      }
    }

    return result;
  }

  async reconcilePendingWeChatCharges(input: {
    now?: Date;
    limit?: number;
    userId?: string;
  } = {}): Promise<{ scanned: number; paid: number; failed: number }> {
    if (!this.weChatAutoRenewProvider) {
      throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
    }
    const runtime = getRuntimeConfig();
    const now = input.now ?? new Date();
    const before = new Date(now.getTime() - runtime.payment.wechatAutoRenew.reconcileGraceMs);
    // 只对 pending 且已经过了宽限时间的扣款查单。
    // 刚提交的订单先等微信回调，避免 worker 过早查单造成无意义请求。
    const charges = await this.autoRenewRepository.listChargesByStatuses({
      provider: "wechat",
      statuses: ["pending"],
      before,
      limit: input.limit ?? runtime.payment.wechatAutoRenew.batchSize,
      userId: input.userId,
    });
    const result = { scanned: charges.length, paid: 0, failed: 0 };

    for (const charge of charges) {
      let snapshot: Awaited<ReturnType<WeChatAutoRenewProvider["queryDeductOrder"]>>;
      try {
        snapshot = await this.weChatAutoRenewProvider.queryDeductOrder({
          outTradeNo: charge.providerChargeId,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.failed += 1;
        await this.writeSystemEventLog({
          userId: charge.userId,
          event: "payment.autorenew.wechat.reconcile_query_failed",
          level: "error",
          errorCode: "WECHAT_AUTORENEW_RECONCILE_QUERY_FAILED",
          errorMessage,
          metadata: {
            chargeId: charge.id,
            providerChargeId: charge.providerChargeId,
            periodKey: charge.periodKey,
          },
        });
        continue;
      }
      const tradeState = String(snapshot.tradeState ?? "").toUpperCase();
      if (tradeState === "SUCCESS") {
        const subscription = await this.autoRenewRepository.findById(charge.autoRenewSubscriptionId);
        if (!subscription) {
          result.failed += 1;
          await this.writeSystemEventLog({
            userId: charge.userId,
            event: "payment.autorenew.wechat.reconcile_missing_subscription",
            level: "error",
            errorCode: "WECHAT_AUTORENEW_RECONCILE_MISSING_SUBSCRIPTION",
            errorMessage: "WeChat query returned SUCCESS but subscription was not found",
            metadata: {
              chargeId: charge.id,
              providerChargeId: charge.providerChargeId,
              contractId: snapshot.contractId,
            },
          });
          continue;
        }
        assertWeChatDebitAmountMatches({
          expectedAmount: charge.amount,
          expectedCurrency: charge.currency,
          actualAmount: snapshot.amount,
          actualCurrency: snapshot.currency,
        });
        // 对账补偿和微信回调走同一套 recordPaidCharge 幂等逻辑。
        // 即使回调稍后又到，也会被 sourceOrderId / providerChargeId 挡住，不会重复发权益。
        await this.recordPaidCharge({
          userId: subscription.userId,
          provider: "wechat",
          providerAgreementId: subscription.providerAgreementId,
          providerChargeId: charge.providerChargeId,
          periodKey: charge.periodKey,
          amount: snapshot.amount ?? charge.amount,
          currency: snapshot.currency ?? charge.currency,
          periodStart: charge.periodStart,
          periodEnd: charge.periodEnd,
          paidAt: new Date(),
          rawPayload: { source: "wechat_autorenew_reconcile", snapshot },
        });
        await this.autoRenewRepository.updateSubscription({
          id: subscription.id,
          status: "active",
          latestTransactionId: snapshot.contractId ?? subscription.latestTransactionId,
          currentPeriodStart: charge.periodStart,
          currentPeriodEnd: charge.periodEnd,
          nextBillingAt: charge.periodEnd ? computeEarlyBillingAt(charge.periodEnd) : null,
        });
        result.paid += 1;
        continue;
      }

      if (["CLOSED", "REVOKED", "PAY_FAIL", "FAILED"].includes(tradeState)) {
        await this.autoRenewRepository.upsertCharge({
          autoRenewSubscriptionId: charge.autoRenewSubscriptionId,
          userId: charge.userId,
          provider: "wechat",
          productCode: "pro_monthly",
          providerChargeId: charge.providerChargeId,
          periodKey: charge.periodKey,
          status: "failed",
          amount: charge.amount,
          currency: charge.currency,
          periodStart: charge.periodStart,
          periodEnd: charge.periodEnd,
          failedAt: new Date(),
          rawPayload: { source: "wechat_autorenew_reconcile", snapshot },
        });
        await this.writeSystemEventLog({
          userId: charge.userId,
          event: "payment.autorenew.wechat.reconcile_failed_charge",
          level: "warn",
          errorCode: "WECHAT_AUTORENEW_RECONCILE_CHARGE_FAILED",
          errorMessage: tradeState || "WeChat auto renew charge failed",
          metadata: {
            chargeId: charge.id,
            providerChargeId: charge.providerChargeId,
            tradeState,
          },
        });
        result.failed += 1;
      }
    }

    return result;
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
    const charge = await this.autoRenewRepository.upsertCharge({
      autoRenewSubscriptionId: subscription.id,
      userId: input.userId,
      provider: input.provider,
      productCode: "pro_monthly",
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
      productCode: "pro_monthly",
      channel: input.provider === "apple" ? "ios_iap" : "wechat",
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

  private async submitInitialWeChatCharge(
    subscription: AutoRenewSubscriptionEntity
  ): Promise<boolean> {
    if (!this.weChatAutoRenewProvider) {
      throw new Error("WECHAT_AUTORENEW_PROVIDER_NOT_CONFIGURED");
    }
    if (!subscription.latestTransactionId) {
      throw new Error("WECHAT_AUTORENEW_INITIAL_CHARGE_MISSING_CONTRACT_ID");
    }

    const runtime = getRuntimeConfig();
    const now = new Date();
    const periodKey = "initial";
    const existingCharge = await this.autoRenewRepository.findChargeByPeriod({
      autoRenewSubscriptionId: subscription.id,
      periodKey,
    });
    if (existingCharge?.status === "paid" || existingCharge?.status === "pending") {
      return false;
    }

    const outTradeNo = createWechatAutoRenewTradeNo(subscription.id, periodKey);
    const periodStart = existingCharge?.periodStart ?? now;
    const periodEnd = existingCharge?.periodEnd ?? addCalendarMonthsClamped(periodStart, 1);
    // 首期扣款也先落库再请求微信：如果进程在请求前后崩溃，后续 worker 还能根据这条 charge 查单/重试。
    // periodKey 固定为 initial，用来挡住微信签约回调重复投递导致的首期重复扣款。
    await this.autoRenewRepository.upsertCharge({
      autoRenewSubscriptionId: subscription.id,
      userId: subscription.userId,
      provider: "wechat",
      productCode: "pro_monthly",
      providerChargeId: outTradeNo,
      periodKey,
      status: "pending",
      amount: runtime.payment.proMonthlyPriceCents,
      currency: "CNY",
      periodStart,
      periodEnd,
      rawPayload: { source: "wechat_autorenew_contract_notify", stage: "initial_before_provider_call" },
    });

    try {
      // 首期扣款跟签约强相关：签约成功后立即受理扣款，让用户尽快拿到 Pro。
      // 这里仍然只记 pending，真正发权益等微信扣款回调或主动查单确认 SUCCESS。
      await this.weChatAutoRenewProvider.applyDeduct({
        contractId: subscription.latestTransactionId,
        outTradeNo,
        description: runtime.payment.wechatAutoRenew.chargeDescription,
        amount: runtime.payment.proMonthlyPriceCents,
        currency: "CNY",
      });
      await this.autoRenewRepository.upsertCharge({
        autoRenewSubscriptionId: subscription.id,
        userId: subscription.userId,
        provider: "wechat",
        productCode: "pro_monthly",
        providerChargeId: outTradeNo,
        periodKey,
        status: "pending",
        amount: runtime.payment.proMonthlyPriceCents,
        currency: "CNY",
        periodStart,
        periodEnd,
        rawPayload: { source: "wechat_autorenew_contract_notify", stage: "initial_submitted" },
      });
      await this.autoRenewRepository.updateSubscription({
        id: subscription.id,
        status: "active",
        // 首期还没确认 paid 前没有权益边界，不能设置下一期扣款时间。
        // 否则 worker 可能把“首期未完成”误当成“下一期续费”。
        nextBillingAt: null,
        metadata: mergeMetadata(subscription.metadata, {
          initialCharge: {
            providerChargeId: outTradeNo,
            submittedAt: new Date().toISOString(),
          },
        }),
      });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const retryAt = computeRetryBillingAt(periodEnd, now);
      await this.autoRenewRepository.upsertCharge({
        autoRenewSubscriptionId: subscription.id,
        userId: subscription.userId,
        provider: "wechat",
        productCode: "pro_monthly",
        providerChargeId: outTradeNo,
        periodKey,
        status: "failed",
        amount: runtime.payment.proMonthlyPriceCents,
        currency: "CNY",
        periodStart,
        periodEnd,
        failedAt: new Date(),
        errorCode: "WECHAT_AUTORENEW_INITIAL_CHARGE_FAILED",
        errorMessage,
        rawPayload: { source: "wechat_autorenew_contract_notify", stage: "initial_failed" },
      });
      await this.autoRenewRepository.updateSubscription({
        id: subscription.id,
        status: "billing_retry",
        nextBillingAt: retryAt,
        metadata: mergeMetadata(subscription.metadata, {
          lastBillingError: errorMessage,
        }),
      });
      await this.writeSystemEventLog({
        userId: subscription.userId,
        event: "payment.autorenew.wechat.initial_charge_failed",
        level: "error",
        errorCode: "WECHAT_AUTORENEW_INITIAL_CHARGE_FAILED",
        errorMessage,
        metadata: {
          autoRenewSubscriptionId: subscription.id,
          providerAgreementId: subscription.providerAgreementId,
          providerChargeId: outTradeNo,
          retryAt: retryAt.toISOString(),
        },
      });
      return false;
    }
  }

  private async writeSystemEventLog(input: {
    userId?: string | null;
    event: string;
    level: "warn" | "error";
    errorCode: string;
    errorMessage?: string | null;
    metadata?: unknown | null;
  }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        userId: input.userId ?? null,
        module: "payment",
        event: input.event,
        level: input.level,
        status: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch {
      // 日志失败不能影响支付主链路；否则可能因为日志库异常导致扣款补偿失败。
    }
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
    const currentPro = await this.subscriptionService.getCurrentSubscription(input.userId, now);
    if (!currentPro.isPro || !currentPro.expiresAt || currentPro.expiresAt <= now) return;

    // 取消自动续费只是不再续扣，不代表当前已付费 Pro 立即失效。
    // 在这段权益还没结束前，不允许马上换到另一个渠道重新签约，避免微信/Apple 同时留下两套平台协议。
    throw new AutoRenewSwitchBlockedError({
      provider: latest.provider,
      currentPeriodEnd: currentPro.expiresAt,
    });
  }
}

function addHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000);
}

function computeEarlyBillingAt(periodEnd: Date): Date {
  // nextBillingAt = currentPeriodEnd - billingLeadMs。
  // 默认 billingLeadMs 是 2 天，给微信 V3 扣费服务的受理、扣款和回调留出缓冲。
  const leadMs = getRuntimeConfig().payment.wechatAutoRenew.billingLeadMs;
  return new Date(periodEnd.getTime() - leadMs);
}

function computeRetryBillingAt(periodEnd: Date | null, now: Date): Date {
  const sixHoursLater = addHours(now, 6);
  if (!periodEnd) return sixHoursLater;
  const latestBeforeExpiry = new Date(periodEnd.getTime() - 60_000);
  return sixHoursLater < latestBeforeExpiry ? sixHoursLater : latestBeforeExpiry;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  return maybeCode === "P2002";
}

function mergeMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return {
    ...base,
    ...patch,
  };
}

function toPeriodKey(periodStart: Date, periodEnd: Date): string {
  return `${periodStart.toISOString().slice(0, 10)}_${periodEnd.toISOString().slice(0, 10)}`;
}

function createWechatAutoRenewTradeNo(autoRenewSubscriptionId: string, periodKey: string): string {
  const digest = createHash("sha256")
    .update(`${autoRenewSubscriptionId}:${periodKey}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `LFR${digest}`.slice(0, 32);
}

function createAutoRenewEntitlementSourceOrderId(
  provider: AutoRenewProvider,
  providerChargeId: string
): string {
  if (provider === "apple") {
    return `apple_iap:${providerChargeId}`;
  }
  return `${provider}_autorenew:${providerChargeId}`;
}

function assertWeChatDebitAmountMatches(input: {
  expectedAmount: number | null;
  expectedCurrency: string | null;
  actualAmount: number | null;
  actualCurrency: string | null;
}): void {
  if (input.actualAmount !== null && input.expectedAmount !== null) {
    if (input.actualAmount !== input.expectedAmount) {
      throw new Error("WECHAT_AUTORENEW_AMOUNT_MISMATCH");
    }
  }
  if (input.actualCurrency && input.expectedCurrency) {
    if (input.actualCurrency !== input.expectedCurrency) {
      throw new Error("WECHAT_AUTORENEW_CURRENCY_MISMATCH");
    }
  }
}
