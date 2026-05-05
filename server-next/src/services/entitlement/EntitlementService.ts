import type { EntitlementRepository } from "@lf/core/ports/repository/EntitlementRepository.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export class DailyQuotaExceededError extends Error {
  readonly code = "DAILY_QUOTA_EXCEEDED";
  readonly remainingChars: number;
  readonly dailyTotalLimit: number;
  readonly usedTotalChars: number;

  constructor(input: {
    remainingChars: number;
    dailyTotalLimit: number;
    usedTotalChars: number;
  }) {
    super(`今日额度已用完。剩余额度 ${input.remainingChars} 字符。`);
    this.remainingChars = input.remainingChars;
    this.dailyTotalLimit = input.dailyTotalLimit;
    this.usedTotalChars = input.usedTotalChars;
  }
}

export interface CurrentEntitlementView {
  userId: string;
  plan: "free" | "pro_monthly";
  isPro: boolean;
  expiresAt: string | null;
  dateKey: string;
  dailyTotalLimit: number;
  usedTotalChars: number;
  remainingChars: number;
}

export class EntitlementService {
  constructor(
    private readonly entitlementRepository: EntitlementRepository,
    private readonly subscriptionService: SubscriptionService
  ) {}

  async assertCanUse(userId: string, requestedChars: number): Promise<void> {
    const dateKey = this.currentDateKey();
    const dailyTotalLimit = await this.resolveDailyLimit(userId);
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey,
      dailyTotalLimit,
    });

    const remainingChars = entitlement.dailyTotalLimit - entitlement.usedTotalChars;
    if (requestedChars > remainingChars) {
      throw new DailyQuotaExceededError({
        remainingChars: Math.max(0, remainingChars),
        dailyTotalLimit: entitlement.dailyTotalLimit,
        usedTotalChars: entitlement.usedTotalChars,
      });
    }
  }

  async consume(userId: string, chars: number): Promise<void> {
    if (chars <= 0) return;

    const dateKey = this.currentDateKey();
    const dailyTotalLimit = await this.resolveDailyLimit(userId);

    await this.entitlementRepository.ensureDaily({
      userId,
      dateKey,
      dailyTotalLimit,
    });

    const entitlement = await this.entitlementRepository.tryConsumeDaily({
      userId,
      dateKey,
      chars,
    });

    if (!entitlement) {
      const latest = await this.entitlementRepository.ensureDaily({
        userId,
        dateKey,
        dailyTotalLimit,
      });
      const remainingChars = latest.dailyTotalLimit - latest.usedTotalChars;

      throw new DailyQuotaExceededError({
        remainingChars: Math.max(0, remainingChars),
        dailyTotalLimit: latest.dailyTotalLimit,
        usedTotalChars: latest.usedTotalChars,
      });
    }
  }

  async getCurrentEntitlement(userId: string): Promise<CurrentEntitlementView> {
    const dateKey = this.currentDateKey();
    const subscription = await this.subscriptionService.getCurrentSubscription(userId);
    const dailyTotalLimit = this.dailyLimitForPlan(subscription.isPro);
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey,
      dailyTotalLimit,
    });
    const remainingChars = entitlement.dailyTotalLimit - entitlement.usedTotalChars;

    return {
      userId,
      plan: subscription.plan,
      isPro: subscription.isPro,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
      dateKey,
      dailyTotalLimit: entitlement.dailyTotalLimit,
      usedTotalChars: entitlement.usedTotalChars,
      remainingChars: Math.max(0, remainingChars),
    };
  }

  private currentDateKey(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: getRuntimeConfig().quotaTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now);
  }

  private async resolveDailyLimit(userId: string): Promise<number> {
    const subscription = await this.subscriptionService.getCurrentSubscription(userId);

    return this.dailyLimitForPlan(subscription.isPro);
  }

  private dailyLimitForPlan(isPro: boolean): number {
    const config = getRuntimeConfig();
    return isPro ? config.proDailyTotalLimit : config.freeDailyTotalLimit;
  }
}
