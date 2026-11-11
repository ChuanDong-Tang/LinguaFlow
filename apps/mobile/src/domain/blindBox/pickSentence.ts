import { cardClozeBlankTone } from "../cloze/cardClozeCorrectness";

type Blank = { id: string; segmentId: string; startUtf16: number; mastered?: boolean; lastResult?: "correct" | "incorrect" };

/**
 * 盲盒 shows one sentence per card (2026-11 feedback):
 * - never answered: the first sentence that has a blank;
 * - answered before: the first sentence with a blank answered wrong;
 * - everything right: the first sentence with a blank again.
 * Returns the segment id, or null when the card has no blanks.
 */
export function pickBlindBoxSentence(segmentIds: readonly string[], blanks: readonly Blank[]): string | null {
  const order = new Map(segmentIds.map((id, index) => [id, index]));
  const withBlanks = [...new Set([...blanks]
    .filter((blank) => order.has(blank.segmentId))
    .sort((a, b) => order.get(a.segmentId)! - order.get(b.segmentId)! || a.startUtf16 - b.startUtf16)
    .map((blank) => blank.segmentId))];
  if (!withBlanks.length) return null;
  const tones = blanks.map((blank) => ({ segmentId: blank.segmentId, tone: cardClozeBlankTone(blank, {}) }));
  if (tones.every((item) => item.tone === "unanswered")) return withBlanks[0]!;
  return withBlanks.find((segmentId) => tones.some((item) => item.segmentId === segmentId && item.tone === "incorrect")) ?? withBlanks[0]!;
}

/** Start the set at the tapped card, keeping the dealt order after it. */
export function blindBoxOrder(ids: readonly string[], first: string): string[] {
  const index = ids.indexOf(first);
  return index < 0 ? [...ids] : [...ids.slice(index), ...ids.slice(0, index)];
}
