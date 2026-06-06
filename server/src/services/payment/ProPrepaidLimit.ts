import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { addCalendarMonthsClamped } from "../time/calendarMath.js";
import type { SubscriptionService } from "../subscription/SubscriptionService.js";

export class ProRenewalTooEarlyError extends Error {
  readonly code = "PRO_RENEWAL_TOO_EARLY";
  readonly expiresAt: Date;
  readonly maxAllowedExpiresAt: Date;

  constructor(input: { expiresAt: Date; maxAllowedExpiresAt: Date }) {
    super("Pro prepaid months limit reached");
    this.expiresAt = input.expiresAt;
    this.maxAllowedExpiresAt = input.maxAllowedExpiresAt;
  }
}

export async function assertCanGrantSingleProMonthly(input: {
  userId: string;
  subscriptionService: SubscriptionService;
  now?: Date;
}): Promise<void> {
  const config = getRuntimeConfig();
  const now = input.now ?? new Date();
  const current = await input.subscriptionService.getCurrentSubscription(input.userId, now);
  if (!current.isPro || !current.expiresAt) return;

  const maxAllowedExpiresAt = addCalendarMonthsClamped(
    now,
    config.payment.proMonthlyMaxPrepaidMonths - 1
  );
  if (current.expiresAt <= maxAllowedExpiresAt) return;

  // 单次月卡最多只能把 Pro 权益预存到“现在 + maxPrepaidMonths”附近。
  // 因为本次购买会再顺延 1 个月，所以这里用 maxPrepaidMonths - 1 判断当前剩余权益。
  throw new ProRenewalTooEarlyError({
    expiresAt: current.expiresAt,
    maxAllowedExpiresAt,
  });
}
