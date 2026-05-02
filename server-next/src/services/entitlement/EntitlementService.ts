import type { EntitlementRepository } from "@lf/core/ports/repository/EntitlementRepository.js";

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

export class EntitlementService {
  constructor(private readonly entitlementRepository: EntitlementRepository) {}

  async assertCanUse(userId: string, requestedChars: number): Promise<void> {
    const entitlement = await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: this.currentDateKey(),
      dailyTotalLimit: this.defaultDailyLimitForUser(userId),
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

    await this.entitlementRepository.ensureDaily({
      userId,
      dateKey: this.currentDateKey(),
      dailyTotalLimit: this.defaultDailyLimitForUser(userId),
    });

    await this.entitlementRepository.consumeDaily({
      userId,
      dateKey: this.currentDateKey(),
      chars,
    });
  }

  private currentDateKey(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.LF_QUOTA_TIME_ZONE ?? "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now);
  }

  private defaultDailyLimitForUser(userId: string): number {
    if (userId === "mock_user_001") {
      return Number(process.env.LF_PRO_DAILY_TOTAL_LIMIT ?? "10000");
    }
    return Number(process.env.LF_FREE_DAILY_TOTAL_LIMIT ?? "500");
  }
}
