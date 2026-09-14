import type {
  SubscriptionEntity,
  SubscriptionGrantProvider,
  SubscriptionGrantSourceType,
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
  /** Paid/legacy grant used to anchor monthly quota windows independently of manual overlays. */
  billingSubscription: SubscriptionEntity | null;
}

export interface OpenOrRenewMembershipInput {
  userId: string;
  plan: SubscriptionPlan;
  sourceOrderId: string;
  months?: number;
  now?: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  sourceType?: SubscriptionGrantSourceType;
  sourceProvider?: SubscriptionGrantProvider | null;
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
    const active = await this.subscriptionRepository.findActiveByUserId(userId, now);
    const subscription = selectHighestEntitlement(active);
    const billingSubscription = selectHighestEntitlement(
      active.filter((grant) => grant.sourceType !== "manual"),
    );

    if (!subscription) {
      return {
        plan: "free",
        tier: "free",
        isPro: false,
        isPlus: false,
        isMember: false,
        expiresAt: null,
        subscription: null,
        billingSubscription: null,
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
      billingSubscription,
    };
  }

  async hasAppliedSourceOrder(sourceOrderId: string): Promise<boolean> {
    return (await this.subscriptionRepository.findBySourceOrderId(sourceOrderId)) !== null;
  }

  /** End only the replaced provider grant; manual and legacy overlays stay untouched. */
  async supersedePaymentGrant(input: {
    sourceOrderId: string;
    provider: SubscriptionGrantProvider;
    supersededAt: Date;
  }): Promise<SubscriptionEntity | null> {
    return this.subscriptionRepository.cancelActiveBySourceOrderId({
      sourceOrderId: input.sourceOrderId,
      cancelledAt: input.supersededAt,
      expiresAt: input.supersededAt,
      sourceType: "payment",
      sourceProvider: input.provider,
    });
  }

  /** 支付成功后发放独立会员权益；sourceOrderId 保证同一订单不会重复发放。 */
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
          sourceType: input.sourceType,
          sourceProvider: input.sourceProvider,
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

    const explicitPeriodEnd = input.periodEnd && input.periodEnd > now ? input.periodEnd : null;
    const sourceType = input.sourceType ?? "legacy";
    const currentForSource = explicitPeriodEnd
      ? null
      : await this.subscriptionRepository.findLatestActiveBySource({
          userId: input.userId,
          now,
          sourceType,
          sourceProvider: input.sourceProvider,
        });
    const currentExpiresAt = currentForSource?.expiresAt && currentForSource.expiresAt > now
      ? currentForSource.expiresAt
      : null;
    const startedAt = resolveGrantStart({
      now,
      currentExpiresAt,
      explicitPeriodEnd,
      periodStart: input.periodStart,
    });
    const rawExpiresAt = explicitPeriodEnd ?? addCalendarMonthsClamped(startedAt, months);
    // Provider periods are authoritative. Fixed-duration purchases only stack
    // behind grants from the same isolated source; manual and payment expiry
    // dates must never extend one another.
    const expiresAt = rawExpiresAt;

    const subscription = await this.subscriptionRepository.create({
      userId: input.userId,
      plan: input.plan,
      status: "active",
      startedAt,
      expiresAt,
      sourceOrderId: input.sourceOrderId,
      sourceType,
      sourceProvider: input.sourceProvider ?? null,
    });

    return {
      subscription,
      alreadyApplied: false,
    };
  }
}

function tierForPlan(plan: SubscriptionPlan): MembershipTier {
  return plan.startsWith("plus_") ? "plus" : "pro";
}

function selectHighestEntitlement(active: SubscriptionEntity[]): SubscriptionEntity | null {
  return [...active].sort((left, right) => {
    const tierDifference = tierRank(tierForPlan(right.plan)) - tierRank(tierForPlan(left.plan));
    if (tierDifference !== 0) return tierDifference;
    const expiryDifference = right.expiresAt.getTime() - left.expiresAt.getTime();
    if (expiryDifference !== 0) return expiryDifference;
    return right.createdAt.getTime() - left.createdAt.getTime();
  })[0] ?? null;
}

function tierRank(tier: MembershipTier): number {
  if (tier === "pro") return 2;
  if (tier === "plus") return 1;
  return 0;
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
