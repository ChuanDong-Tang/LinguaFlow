import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import type { AutoRenewRepository } from "@lf/core/ports/repository/AutoRenewRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { assertCanGrantSingleProMonthly } from "./ProPrepaidLimit.js";

export type PaymentChannel = "wechat" | "ios_iap";
export type PaymentProductCode = "pro_monthly";
export type EntitlementGrantMode = "fixed_duration" | "subscription_period";
export type PrepaidLimitMode = "enforce" | "skip";

export interface GrantEntitlementInput {
  userId: string;
  sourceOrderId: string;
  productCode: PaymentProductCode;
  channel: PaymentChannel;
  grantMode: EntitlementGrantMode;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  prepaidLimit?: PrepaidLimitMode;
}

export interface GrantEntitlementResult {
  alreadyApplied: boolean;
  months: number;
}

/**
 * 统一支付权益发放入口：
 * 各支付渠道只负责“验单/验签”，权益发放规则集中在这里。
 */
export class PaymentEntitlementService {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly autoRenewRepository?: AutoRenewRepository
  ) {}

  async assertCanStartNewProPurchase(userId: string): Promise<void> {
    // 所有“新开一笔 Pro 购买/订阅”的入口先走这里；已有有效 Pro 时不允许再买。
    await assertCanGrantSingleProMonthly({
      userId,
      subscriptionService: this.subscriptionService,
    });
  }

  async grantAfterPayment(input: GrantEntitlementInput): Promise<GrantEntitlementResult> {
    const months = resolveMonthsByProductCode(input.productCode);
    const prepaidLimit = input.prepaidLimit ?? defaultPrepaidLimit(input.grantMode);
    const alreadyApplied = await this.subscriptionService.hasAppliedSourceOrder(input.sourceOrderId);
    // 已经发过权益的订单要优先按幂等处理，避免 restore/webhook 重放被 active Pro 拦住。
    if (prepaidLimit !== "skip" && !alreadyApplied) {
      await assertCanGrantSingleProMonthly({
        userId: input.userId,
        subscriptionService: this.subscriptionService,
      });
    }
    const period = resolveGrantPeriod({
      grantMode: input.grantMode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
    const result = await this.subscriptionService.openOrRenewPro({
      userId: input.userId,
      sourceOrderId: input.sourceOrderId,
      months,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });
    if (!result.alreadyApplied) {
      await this.syncAutoRenewBillingAfterGrant(input.userId, result.subscription.expiresAt);
    }

    return {
      alreadyApplied: result.alreadyApplied,
      months,
    };
  }

  private async syncAutoRenewBillingAfterGrant(
    userId: string,
    proAccessUntil: Date
  ): Promise<void> {
    if (!this.autoRenewRepository) return;
    const autoRenew = await this.autoRenewRepository.findActiveByUserId(userId);
    if (!autoRenew || !["active", "billing_retry"].includes(autoRenew.status)) return;
    if (autoRenew.currentPeriodEnd && autoRenew.currentPeriodEnd >= proAccessUntil) return;

    await this.autoRenewRepository.updateSubscription({
      id: autoRenew.id,
      status: "active",
      currentPeriodEnd: proAccessUntil,
      nextBillingAt: computeEarlyBillingAt(proAccessUntil),
      metadata: mergeMetadata(autoRenew.metadata, {
        billingShift: {
          source: "one_time_pro_grant",
          proAccessUntil: proAccessUntil.toISOString(),
          shiftedAt: new Date().toISOString(),
        },
      }),
    });
  }
}

function resolveMonthsByProductCode(productCode: PaymentProductCode): number {
  if (productCode === "pro_monthly") return 1;
  return 1;
}

function defaultPrepaidLimit(grantMode: EntitlementGrantMode): PrepaidLimitMode {
  return grantMode === "fixed_duration" ? "enforce" : "skip";
}

function resolveGrantPeriod(input: {
  grantMode: EntitlementGrantMode;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}): { periodStart: Date | null; periodEnd: Date | null } {
  if (input.grantMode === "fixed_duration") {
    return { periodStart: null, periodEnd: null };
  }

  if (input.periodEnd) {
    return {
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd,
    };
  }

  console.warn("[payment] subscription period grant missing periodEnd; falling back to fixed duration", {
    grantMode: input.grantMode,
    periodStart: input.periodStart?.toISOString() ?? null,
  });
  return { periodStart: null, periodEnd: null };
}

function computeEarlyBillingAt(periodEnd: Date): Date {
  const leadMs = getRuntimeConfig().payment.wechatAutoRenew.billingLeadMs;
  return new Date(periodEnd.getTime() - leadMs);
}

function mergeMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}),
    ...patch,
  };
}
