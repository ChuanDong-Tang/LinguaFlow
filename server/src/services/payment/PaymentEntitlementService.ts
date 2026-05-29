import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import type { AutoRenewRepository } from "@lf/core/ports/repository/AutoRenewRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export type PaymentChannel = "wechat" | "ios_iap";
export type PaymentProductCode = "pro_monthly";

export interface GrantEntitlementInput {
  userId: string;
  sourceOrderId: string;
  productCode: PaymentProductCode;
  channel: PaymentChannel;
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

  async grantAfterPayment(input: GrantEntitlementInput): Promise<GrantEntitlementResult> {
    const months = resolveMonthsByProductCode(input.productCode);
    const result = await this.subscriptionService.openOrRenewPro({
      userId: input.userId,
      sourceOrderId: input.sourceOrderId,
      months,
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
