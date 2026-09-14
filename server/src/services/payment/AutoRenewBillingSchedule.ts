const EARLY_RECONCILE_LEAD_MS = 2 * 24 * 60 * 60 * 1000;
const OVERDUE_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Reconcile ordinary subscriptions two days before renewal. Store sandbox
 * periods can be shorter than that lead time, so schedule those at their
 * actual period end instead of persisting an already-due timestamp.
 */
export function computeEarlyBillingAt(periodEnd: Date, now: Date = new Date()): Date {
  const periodEndMs = periodEnd.getTime();
  const nowMs = now.getTime();
  const earlyBillingMs = periodEndMs - EARLY_RECONCILE_LEAD_MS;

  if (earlyBillingMs > nowMs) return new Date(earlyBillingMs);
  if (periodEndMs > nowMs) return new Date(periodEndMs);
  return new Date(nowMs + OVERDUE_RETRY_DELAY_MS);
}
