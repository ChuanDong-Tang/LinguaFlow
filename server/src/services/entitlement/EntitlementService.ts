import type { EntitlementRepository } from "@lf/core/ports/repository/EntitlementRepository.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";
import type { CurrentSubscriptionPlan, MembershipTier } from "../subscription/SubscriptionService.js";
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
  plan: CurrentSubscriptionPlan;
  tier: MembershipTier;
  isPro: boolean;
  isPlus: boolean;
  isMember: boolean;
  expiresAt: string | null;
  dateKey: string;
  dailyTotalLimit: number;
  validUntil: string | null;
  usedTotalChars: number;
  remainingChars: number;
  quotas: {
    aiDailyChars: number;
    cloudImages: number;
    usedCloudImages: number;
    remainingCloudImages: number;
  };
  features: {
    cloudSync: boolean;
    conversationHistorySync: boolean;
    highQualityTts: boolean;
  };
}

export class EntitlementService {
  constructor(
    private readonly entitlementRepository: EntitlementRepository,
    private readonly subscriptionService: SubscriptionService
  ) {}

  // 严格检查额度够不够
  async assertCanUse(userId: string, requestedChars: number, options?: { dateKey?: string }): Promise<void> {
    const quota = await this.resolveQuota(userId, options);
    // 会员按自然日额度；免费用户复用一条固定记录作为永久总额度池。
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
      imageLimit: quota.imageLimit,
    });

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
    // 会员按自然日额度；免费用户复用一条固定记录作为永久总额度池。
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
      imageLimit: quota.imageLimit,
    });

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

    await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
      imageLimit: quota.imageLimit,
    });

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
        imageLimit: quota.imageLimit,
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
    await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
      imageLimit: quota.imageLimit,
    });

    // 已经发起的生成要保证完整返回；这里最多把额度扣到上限，不让 usedTotalChars 超过 dailyTotalLimit。
    await this.entitlementRepository.consumeDailyUpToLimit({
      userId,
      dateKey: quota.dateKey,
      chars,
    });
  }

  async getCurrentEntitlement(userId: string): Promise<CurrentEntitlementView> {
    const subscription = await this.subscriptionService.getCurrentSubscription(userId);
    const quota = this.quotaForPlan(subscription.tier);
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: quota.dateKey,
      dailyTotalLimit: quota.totalLimit,
      imageLimit: quota.imageLimit,
    });
    const remainingChars = entitlement.dailyTotalLimit - entitlement.usedTotalChars;

    return {
      userId,
      plan: subscription.plan,
      tier: subscription.tier,
      isPro: subscription.isPro,
      isPlus: subscription.isPlus,
      isMember: subscription.isMember,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
      dateKey: quota.dateKey,
      dailyTotalLimit: entitlement.dailyTotalLimit,
      validUntil: null,
      usedTotalChars: entitlement.usedTotalChars,
      remainingChars: Math.max(0, remainingChars),
      quotas: {
        aiDailyChars: entitlement.dailyTotalLimit,
        cloudImages: entitlement.imageLimit,
        usedCloudImages: entitlement.usedImages,
        remainingCloudImages: Math.max(0, entitlement.imageLimit - entitlement.usedImages),
      },
      features: featuresForTier(subscription.tier),
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

    return this.quotaForPlan(subscription.tier, options?.dateKey);
  }

  private quotaForPlan(tier: MembershipTier, preferredDateKey?: string): QuotaWindow {
    const config = getRuntimeConfig();
    if (tier !== "free") {
      // 会员额度按业务时区的每日 dateKey 滚动恢复。
      return {
        dateKey: preferredDateKey ?? this.currentDateKey(),
        totalLimit: tier === "plus" ? config.plusDailyTotalLimit : config.proDailyTotalLimit,
        imageLimit: imageLimitForTier(tier),
      };
    }

    // 免费用户不是每日恢复，而是一个永久的一次性欢迎额度池。
    return {
      dateKey: FREE_TRIAL_DATE_KEY,
      totalLimit: config.freeTrialTotalLimit,
      imageLimit: imageLimitForTier(tier),
    };
  }
}

function featuresForTier(tier: MembershipTier): CurrentEntitlementView["features"] {
  const features = getRuntimeConfig().membershipFeatures;
  const conversationHistorySync = features.conversationHistorySync.includes(tier);
  return {
    // Keep the legacy field aligned with its original chat-history meaning.
    // Card cloud storage is available to every signed-in user and does not use this flag.
    cloudSync: conversationHistorySync,
    conversationHistorySync,
    highQualityTts: features.highQualityTts.includes(tier),
  };
}

function imageLimitForTier(tier: MembershipTier): number {
  const config = getRuntimeConfig();
  if (tier === "pro") return config.proDailyImageLimit;
  if (tier === "plus") return config.plusDailyImageLimit;
  return config.freeTotalImageLimit;
}

// 历史表结构仍叫 dailyTotalLimit/dateKey；这里用固定 dateKey 表示“免费试用总额度”。
const FREE_TRIAL_DATE_KEY = "free_trial";

type QuotaWindow = {
  dateKey: string;
  totalLimit: number;
  imageLimit: number;
};
