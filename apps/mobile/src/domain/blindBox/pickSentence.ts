import { cardClozeBlankTone } from "../cloze/cardClozeCorrectness";

type Blank = { id: string; segmentId: string; startUtf16: number; mastered?: boolean; lastResult?: "correct" | "incorrect" };

export type BlindBoxTone = "unanswered" | "incorrect" | "correct";
export const BLIND_BOX_TONES: readonly BlindBoxTone[] = ["unanswered", "incorrect", "correct"];
/** Default 盲盒 filter: blanks not yet answered or answered wrong (round 4: no all-right sentences). */
export const DEFAULT_BLIND_BOX_TONES: readonly BlindBoxTone[] = ["unanswered", "incorrect"];

/**
 * 盲盒 shows one sentence per card. The sentence is the first one (in reading
 * order) holding a blank whose tone the user chose in 盲盒设置 (未填 / 填错 /
 * 填对). If none matches — the card summary was stale — fall back to a sentence
 * with an open blank, then to the first sentence with blanks. Sentences without
 * blanks never show. Returns null when the card has no blanks.
 */
export function pickBlindBoxSentence(segmentIds: readonly string[], blanks: readonly Blank[], tones: readonly BlindBoxTone[] = BLIND_BOX_TONES): string | null {
  const order = new Map(segmentIds.map((id, index) => [id, index]));
  const sorted = [...blanks]
    .filter((blank) => order.has(blank.segmentId))
    .sort((a, b) => order.get(a.segmentId)! - order.get(b.segmentId)! || a.startUtf16 - b.startUtf16);
  if (!sorted.length) return null;
  const wanted = new Set(tones);
  const toneOf = (blank: Blank): BlindBoxTone => cardClozeBlankTone(blank, {});
  // Within the chosen tones, open blanks (未填 / 填错) still come before 填对.
  const open = sorted.find((blank) => toneOf(blank) !== "correct");
  const match = sorted.find((blank) => toneOf(blank) !== "correct" && wanted.has(toneOf(blank)))
    ?? sorted.find((blank) => wanted.has(toneOf(blank)));
  return (match ?? open ?? sorted[0]!).segmentId;
}

type PracticeCounts = { totalBlanks?: number; answeredBlanks?: number; accuracy?: number | null; status?: string };

/** Blank counts by tone, from the card summary (accuracy is a rounded percentage of answered blanks). */
export function blindBoxToneCounts(summary: PracticeCounts | null | undefined): Record<BlindBoxTone, number> | null {
  if (typeof summary?.totalBlanks !== "number") return null;
  const total = summary.totalBlanks;
  const answered = Math.min(total, summary.answeredBlanks ?? 0);
  const correct = answered && typeof summary.accuracy === "number" ? Math.min(answered, Math.round((summary.accuracy / 100) * answered)) : 0;
  return { unanswered: total - answered, incorrect: answered - correct, correct };
}

/** Cards that can be played in 盲盒: they have at least one blank of a chosen tone. */
export function isBlindBoxPlayable(summary: PracticeCounts | null | undefined, tones: readonly BlindBoxTone[] = BLIND_BOX_TONES): boolean {
  const counts = blindBoxToneCounts(summary);
  if (!counts) return tones.includes("unanswered") && (summary?.status === "clozed" || summary?.status === "completed");
  return tones.some((tone) => counts[tone] > 0);
}

/** Start the set at the tapped card, keeping the dealt order after it. */
export function blindBoxOrder(ids: readonly string[], first: string): string[] {
  const index = ids.indexOf(first);
  return index < 0 ? [...ids] : [...ids.slice(index), ...ids.slice(0, index)];
}
