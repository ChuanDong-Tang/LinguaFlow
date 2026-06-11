import type { EntitlementRepository } from "@lf/core/ports/repository/EntitlementRepository.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export class DailyQuotaExceededError extends Error {
  readonly code = "DAILY_QUOTA_EXCEEDED";
  readonly remainingChars: number;
  readonly totalLimit: number;
  readonly usedTotalChars: number;

  constructor(input: {
    remainingChars: number;
    totalLimit: number;
    usedTotalChars: number;
  }) {
    super(`额度已用完。剩余额度 ${input.remainingChars} 字符。`);
    this.remainingChars = input.remainingChars;
    this.totalLimit = input.totalLimit;
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
  validUntil: string | null;
  usedTotalChars: number;
  remainingChars: number;
}

export class EntitlementService {
  constructor(
    private readonly entitlementRepository: EntitlementRepository,
    private readonly subscriptionService: SubscriptionService
  ) {}

  // 严格检查额度够不够
  async assertCanUse(userId: string, requestedChars: number, options?: { dateKey?: string }): Promise<void> {
    const quota = await this.resolveQuota(userId, options);
    // Pro 仍按自然日额度；免费用户复用一条固定 free_trial 记录作为总额度池。
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
    });
    // 免费额度有效期从该额度记录首次创建时间开始计算，避免每次查询/使用都重新续期。
    this.assertQuotaNotExpired(quota, entitlement.createdAt);

    const remainingChars = entitlement.dailyTotalLimit - entitlement.usedTotalChars;
    if (requestedChars > remainingChars) {
      throw new DailyQuotaExceededError({
        remainingChars: Math.max(0, remainingChars),
        totalLimit: entitlement.dailyTotalLimit,
        usedTotalChars: entitlement.usedTotalChars,
      });
    }
  }

  // 宽松检查，额度不够的时候，允许最后一次发送
  async assertCanStartGeneration(userId: string, options?: { dateKey?: string }): Promise<void> {
    const quota = await this.resolveQuota(userId, options);
    // Pro 仍按自然日额度；免费用户复用一条固定 free_trial 记录作为总额度池。
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
    });
    // 免费额度有效期从该额度记录首次创建时间开始计算，避免每次查询/使用都重新续期。
    this.assertQuotaNotExpired(quota, entitlement.createdAt);

    const remainingChars = entitlement.dailyTotalLimit - entitlement.usedTotalChars;
    if (remainingChars <= 0) {
      throw new DailyQuotaExceededError({
        remainingChars: 0,
        totalLimit: entitlement.dailyTotalLimit,
        usedTotalChars: entitlement.usedTotalChars,
      });
    }
  }

  async consume(userId: string, chars: number, options?: { dateKey?: string }): Promise<void> {
    if (chars <= 0) return;

    const quota = await this.resolveQuota(userId, options);

    // 先确保额度记录存在，再基于记录 createdAt 判断免费试用是否过期。
    const ensured = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
    });
    this.assertQuotaNotExpired(quota, ensured.createdAt);

    const entitlement = await this.entitlementRepository.tryConsumeDaily({
      userId,
      dateKey: quota.dateKey,
      chars,
    });

    if (!entitlement) {
      const latest = await this.entitlementRepository.ensureDaily({
        userId,
        dateKey: quota.dateKey,
        dailyTotalLimit: quota.totalLimit,
      });
      const remainingChars = latest.dailyTotalLimit - latest.usedTotalChars;

      throw new DailyQuotaExceededError({
        remainingChars: Math.max(0, remainingChars),
        totalLimit: latest.dailyTotalLimit,
        usedTotalChars: latest.usedTotalChars,
      });
    }
  }

  async consumeUpToLimit(userId: string, chars: number, options?: { dateKey?: string }): Promise<void> {
    if (chars <= 0) return;

    const quota = await this.resolveQuota(userId, options);
    const ensured = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
    });
    this.assertQuotaNotExpired(quota, ensured.createdAt);

    // 已经发起的生成要保证完整返回；这里最多把额度扣到上限，不让 usedTotalChars 超过 dailyTotalLimit。
    await this.entitlementRepository.consumeDailyUpToLimit({
      userId,
      dateKey: quota.dateKey,
      chars,
    });
  }

  async getCurrentEntitlement(userId: string): Promise<CurrentEntitlementView> {
    const subscription = await this.subscriptionService.getCurrentSubscription(userId);
    const quota = this.quotaForPlan(subscription.isPro);
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
    });
    const validUntil = this.resolveValidUntil(quota, entitlement.createdAt);
    const isExpired = validUntil !== null && validUntil.getTime() <= Date.now();
    const remainingChars = entitlement.dailyTotalLimit - entitlement.usedTotalChars;

    return {
      userId,
      plan: subscription.plan,
      isPro: subscription.isPro,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
      dateKey: quota.dateKey,
      dailyTotalLimit: entitlement.dailyTotalLimit,
      validUntil: validUntil?.toISOString() ?? null,
      usedTotalChars: entitlement.usedTotalChars,
      remainingChars: isExpired ? 0 : Math.max(0, remainingChars),
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

  private async resolveQuota(userId: string, options?: { dateKey?: string }): Promise<QuotaWindow> {
    const subscription = await this.subscriptionService.getCurrentSubscription(userId);

    return this.quotaForPlan(subscription.isPro, options?.dateKey);
  }

  private quotaForPlan(isPro: boolean, preferredDateKey?: string): QuotaWindow {
    const config = getRuntimeConfig();
    if (isPro) {
      // Pro 额度仍然按业务时区的每日 dateKey 滚动恢复。
      return {
        dateKey: preferredDateKey ?? this.currentDateKey(),
        totalLimit: config.proDailyTotalLimit,
        validDays: null,
      };
    }

    // 免费用户不是每日恢复，而是一个总试用额度池：free_trial + 总额度 + 有效天数。
    return {
      dateKey: FREE_TRIAL_DATE_KEY,
      totalLimit: config.freeTrialTotalLimit,
      validDays: config.freeTrialValidDays,
    };
  }

  private assertQuotaNotExpired(quota: QuotaWindow, entitlementCreatedAt: Date): void {
    const validUntil = this.resolveValidUntil(quota, entitlementCreatedAt);
    if (!validUntil || validUntil.getTime() > Date.now()) return;
    throw new DailyQuotaExceededError({
      remainingChars: 0,
      totalLimit: quota.totalLimit,
      usedTotalChars: quota.totalLimit,
    });
  }

  private resolveValidUntil(quota: QuotaWindow, entitlementCreatedAt: Date): Date | null {
    if (!quota.validDays) return null;
    // 免费试用有效期以首次创建 free_trial entitlement 的时间为起点。
    return new Date(entitlementCreatedAt.getTime() + quota.validDays * 24 * 60 * 60 * 1000);
  }
}

// 历史表结构仍叫 dailyTotalLimit/dateKey；这里用固定 dateKey 表示“免费试用总额度”。
const FREE_TRIAL_DATE_KEY = "free_trial";

type QuotaWindow = {
  dateKey: string;
  totalLimit: number;
  validDays: number | null;
};
