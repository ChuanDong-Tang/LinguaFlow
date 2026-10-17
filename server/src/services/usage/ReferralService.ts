import { lockPointAccount } from './bonusAllocation.js';

export const REFERRAL_REWARD_POINTS = 10_000;
export class ReferralError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function normalizeReferralCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{3,31}$/.test(code)) throw new ReferralError('REFERRAL_INVALID');
  return code;
}

/** No reward amount or identity is trusted from Mobile. */
export class ReferralService {
  constructor(private readonly prisma: { $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> }) {}

  async complete(userId: string, rawCode?: string) {
    const code = rawCode === undefined ? null : normalizeReferralCode(rawCode);
    return this.prisma.$transaction(async tx => {
      await lockPointAccount(tx, userId);
      const existing = await tx.referralRedemption.findUnique({ where: { userId } });
      if (existing) {
        if (code && code !== existing.code) throw new ReferralError('REFERRAL_ALREADY_CLAIMED');
        return { grantedPoints: existing.grantedPoints as number, alreadyClaimed: true };
      }
      const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, referralEligible: true } });
      if (!user || user.status !== 'active') throw new ReferralError('REFERRAL_NOT_ELIGIBLE');
      if (!code) {
        await tx.user.update({ where: { id: userId }, data: { referralEligible: false } });
        return { grantedPoints: 0, alreadyClaimed: false };
      }
      const preference = await tx.userPreference.findUnique({ where: { userId }, select: { guideState: true } });
      if (!user.referralEligible || preference?.guideState?.account_onboarding_v1?.completedAt) {
        throw new ReferralError('REFERRAL_NOT_ELIGIBLE');
      }
      // Row-level conditional update serializes the last available redemption
      // across DIFFERENT users; the account lock handles retries for one user.
      const rows = await tx.$queryRawUnsafe(
        `UPDATE "referral_codes" SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = NOW()
         WHERE "code" = $1 AND "enabled" = true
           AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
           AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions") RETURNING "code"`, code,
      );
      if (!rows.length) throw new ReferralError('REFERRAL_INVALID');
      await tx.referralRedemption.create({ data: { userId, code, grantedPoints: REFERRAL_REWARD_POINTS } });
      await tx.user.update({ where: { id: userId }, data: { referralEligible: false } });
      return { grantedPoints: REFERRAL_REWARD_POINTS, alreadyClaimed: false };
    });
  }
}
