/**
 * Home-card completion ring (2026-11): replaces the status icons.
 * - no blanks yet: empty gray ring
 * - blanks, never answered: gray, 10% filled
 * - answered: filled by accuracy; yellow while any blank is wrong, green + check when all right
 */
export type CardProgressRing = { fraction: number; tone: "empty" | "pending" | "partial" | "perfect"; label: string };

export function cardProgressRing(summary: { totalBlanks?: number; answeredBlanks?: number; accuracy?: number | null } | null | undefined): CardProgressRing {
  const total = summary?.totalBlanks ?? 0;
  if (!total) return { fraction: 0, tone: "empty", label: "0%" };
  const accuracy = summary?.accuracy;
  if (!summary?.answeredBlanks || accuracy === null || accuracy === undefined) return { fraction: 0.1, tone: "pending", label: "0%" };
  const fraction = Math.max(0.1, Math.min(1, accuracy / 100));
  return { fraction, tone: accuracy >= 100 ? "perfect" : "partial", label: `${accuracy}%` };
}
