import type { SubscriptionService } from "../subscription/SubscriptionService.js";

export class ProRenewalTooEarlyError extends Error {
  readonly code = "PRO_RENEWAL_TOO_EARLY";
  readonly expiresAt: Date;

  constructor(input: { expiresAt: Date }) {
    super("Pro is already active");
    this.expiresAt = input.expiresAt;
  }
}

export async function assertCanGrantSingleProMonthly(input: {
  userId: string;
  subscriptionService: SubscriptionService;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const current = await input.subscriptionService.getCurrentSubscription(input.userId, now);
  if (!current.isPro || !current.expiresAt) return;

  // 现在的策略是不允许 active Pro 期间再新开一次月卡/订阅，避免用户重复扣款或囤权益。
  throw new ProRenewalTooEarlyError({
    expiresAt: current.expiresAt,
  });
}
