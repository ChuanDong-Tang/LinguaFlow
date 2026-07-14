import type {
  SubscriptionEntity,
  SubscriptionPlan,
  SubscriptionRepository,
} from "@lf/core/ports/repository/SubscriptionRepository.js";
import { addCalendarMonthsClamped } from "../time/calendarMath.js";

export type CurrentSubscriptionPlan = SubscriptionPlan | "free";
export type MembershipTier = "free" | "plus" | "pro";

export interface CurrentSubscriptionView {
  plan: CurrentSubscriptionPlan;
  tier: MembershipTier;
  isPro: boolean;
  isPlus: boolean;
  isMember: boolean;
  expiresAt: Date | null;
  subscription: SubscriptionEntity | null;
}

export interface OpenOrRenewMembershipInput {
  userId: string;
  plan: SubscriptionPlan;
  sourceOrderId: string;
  months?: number;
  now?: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface OpenOrRenewMembershipResult {
  subscription: SubscriptionEntity;
  alreadyApplied: boolean;
}

export class SubscriptionService {
  constructor(private readonly subscriptionRepository: SubscriptionRepository) {}

  /** 查询当前会员状态：没有有效订阅时，业务上视为 free。 */
  async getCurrentSubscription(
    userId: string,
    now = new Date()
  ): Promise<CurrentSubscriptionView> {
    const subscription = await this.subscriptionRepository.findCurrentActiveByUserId(userId, now);

    if (!subscription) {
      return {
        plan: "free",
        tier: "free",
        isPro: false,
        isPlus: false,
        isMember: false,
        expiresAt: null,
        subscription: null,
      };
    }
    const tier = tierForPlan(subscription.plan);

    return {
      plan: subscription.plan,
      tier,
      // Legacy compatibility: old clients use isPro as "has paid membership".
      isPro: tier !== "free",
      isPlus: tier === "plus",
      isMember: tier !== "free",
      expiresAt: subscription.expiresAt,
      subscription,
    };
  }

  async hasAppliedSourceOrder(sourceOrderId: string): Promise<boolean> {
    return (await this.subscriptionRepository.findBySourceOrderId(sourceOrderId)) !== null;
  }

  /** 支付成功后开通或续期 Pro；sourceOrderId 保证同一订单不会重复发权益。 */
  async openOrRenewMembership(input: OpenOrRenewMembershipInput): Promise<OpenOrRenewMembershipResult> {
    const months = input.months ?? 1;
    const now = input.now ?? new Date();

    const existingByOrder = await this.subscriptionRepository.findBySourceOrderId(
      input.sourceOrderId
    );

    if (existingByOrder) {
      if (input.periodEnd && input.periodEnd > now) {
        const wasAlreadyApplied =
          existingByOrder.status === "active" && existingByOrder.expiresAt >= input.periodEnd;
        const synced = await this.subscriptionRepository.syncPeriodBySourceOrderId({
          sourceOrderId: input.sourceOrderId,
          plan: input.plan,
          startedAt: input.periodStart ?? existingByOrder.startedAt,
          expiresAt: input.periodEnd,
        });
        if (synced) {
          return {
            subscription: synced,
            alreadyApplied: wasAlreadyApplied,
          };
        }
      }
      return {
        subscription: existingByOrder,
        alreadyApplied: true,
      };
    }

    const current = await this.subscriptionRepository.findCurrentActiveByUserId(input.userId, now);
    const explicitPeriodEnd = input.periodEnd && input.periodEnd > now ? input.periodEnd : null;
    const currentExpiresAt = current && current.expiresAt > now ? current.expiresAt : null;
    const startedAt = resolveGrantStart({
      now,
      currentExpiresAt,
      explicitPeriodEnd,
      periodStart: input.periodStart,
    });
    const rawExpiresAt = explicitPeriodEnd ?? addCalendarMonthsClamped(startedAt, months);
    // 支付事件只能延长或保持当前权益，不能把更长的单买权益覆盖成更短的平台订阅周期。
    const expiresAt =
      currentExpiresAt && currentExpiresAt > rawExpiresAt ? currentExpiresAt : rawExpiresAt;

    const subscription = await this.subscriptionRepository.create({
      userId: input.userId,
      plan: input.plan,
      status: "active",
      startedAt,
      expiresAt,
      sourceOrderId: input.sourceOrderId,
    });

    return {
      subscription,
      alreadyApplied: false,
    };
  }
}

function tierForPlan(plan: SubscriptionPlan): MembershipTier {
  return plan === "plus_monthly" ? "plus" : "pro";
}

function resolveGrantStart(input: {
  now: Date;
  currentExpiresAt: Date | null;
  explicitPeriodEnd: Date | null;
  periodStart?: Date | null;
}): Date {
  if (input.explicitPeriodEnd && input.periodStart) return input.periodStart;
  return input.currentExpiresAt ?? input.now;
}
