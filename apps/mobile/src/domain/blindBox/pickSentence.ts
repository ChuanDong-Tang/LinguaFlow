import { cardClozeBlankTone } from "../cloze/cardClozeCorrectness";

type Blank = { id: string; segmentId: string; startUtf16: number; mastered?: boolean; lastResult?: "correct" | "incorrect" };

/**
 * 盲盒 shows one sentence per card (2026-11 feedback, round 3):
 * - first a sentence that still has an unanswered or wrong blank;
 * - only when none is left, a sentence whose blanks were all answered right;
 * - sentences without blanks never show. Returns null when the card has no blanks.
 */
export function pickBlindBoxSentence(segmentIds: readonly string[], blanks: readonly Blank[]): string | null {
  const order = new Map(segmentIds.map((id, index) => [id, index]));
  const sorted = [...blanks]
    .filter((blank) => order.has(blank.segmentId))
    .sort((a, b) => order.get(a.segmentId)! - order.get(b.segmentId)! || a.startUtf16 - b.startUtf16);
  if (!sorted.length) return null;
  const open = sorted.find((blank) => cardClozeBlankTone(blank, {}) !== "correct");
  return (open ?? sorted[0]!).segmentId;
}

/** Cards that can be played in 盲盒: they have at least one blank. */
export function isBlindBoxPlayable(summary: { totalBlanks?: number; status?: string } | null | undefined): boolean {
  if (typeof summary?.totalBlanks === "number") return summary.totalBlanks > 0;
  return summary?.status === "clozed" || summary?.status === "completed";
}

/** Start the set at the tapped card, keeping the dealt order after it. */
export function blindBoxOrder(ids: readonly string[], first: string): string[] {
  const index = ids.indexOf(first);
  return index < 0 ? [...ids] : [...ids.slice(index), ...ids.slice(0, index)];
}
