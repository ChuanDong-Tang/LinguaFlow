/** Reserve/settle monthly points first. Persistent bonus is never renewed. */
export function allocatePoints(amount: number, monthlyAvailable: number, bonusAvailable: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("INVALID_POINTS");
  const monthly = Math.min(amount, Math.max(0, monthlyAvailable));
  const bonus = amount - monthly;
  if (bonus > Math.max(0, bonusAvailable)) throw new Error("INSUFFICIENT_POINTS");
  return { monthly, bonus };
}

export async function lockPointAccount(tx: any, userId: string): Promise<void> {
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"', `point-account:${userId}`);
}
