import { cardClozeBlankTone } from "../cloze/cardClozeCorrectness";

type Blank = { id: string; segmentId: string; startUtf16: number; mastered?: boolean; lastResult?: "correct" | "incorrect" };

export type BlindBoxTone = "unanswered" | "incorrect" | "correct";
export const BLIND_BOX_TONES: readonly BlindBoxTone[] = ["unanswered", "incorrect", "correct"];
/** Default 盲盒 filter: blanks not yet answered or answered wrong (round 4: no all-right sentences). */
export const DEFAULT_BLIND_BOX_TONES: readonly BlindBoxTone[] = ["unanswered", "incorrect"];

/**
 * 盲盒 sentence for a card. Sentences are ranked in reading order, open blanks
 * (未填 / 填错) of the chosen tones first, then 填对 of the chosen tones.
 * `occurrence` (round 4+): the n-th time this card appears in one set gets the
 * n-th ranked sentence, so a repeated card never repeats its sentence. Past the
 * matching ones it falls back to other sentences with blanks. Sentences without
 * blanks never show. Returns null when the card has no blanks.
 */
export function pickBlindBoxSentence(segmentIds: readonly string[], blanks: readonly Blank[], tones: readonly BlindBoxTone[] = BLIND_BOX_TONES, occurrence = 1): string | null {
  const order = new Map(segmentIds.map((id, index) => [id, index]));
  const sorted = [...blanks]
    .filter((blank) => order.has(blank.segmentId))
    .sort((a, b) => order.get(a.segmentId)! - order.get(b.segmentId)! || a.startUtf16 - b.startUtf16);
  if (!sorted.length) return null;
  const wanted = new Set(tones);
  const toneOf = (blank: Blank): BlindBoxTone => cardClozeBlankTone(blank, {});
  const ranked: string[] = [];
  const add = (blank: Blank | undefined) => { if (blank && !ranked.includes(blank.segmentId)) ranked.push(blank.segmentId); };
  sorted.filter((blank) => toneOf(blank) !== "correct" && wanted.has(toneOf(blank))).forEach(add);
  sorted.filter((blank) => wanted.has(toneOf(blank))).forEach(add);
  // Stale summary / beyond the matching ones: open blanks, then any sentence with blanks.
  sorted.filter((blank) => toneOf(blank) !== "correct").forEach(add);
  sorted.forEach(add);
  const index = Math.max(0, Math.floor(occurrence) - 1);
  return ranked[Math.min(index, ranked.length - 1)]!;
}

/** A set entry: the card id the first time, `id~n` for its n-th sentence in the same set. */
export function blindBoxEntryId(recordId: string, occurrence: number): string {
  return occurrence <= 1 ? recordId : `${recordId}~${occurrence}`;
}

export function parseBlindBoxEntry(entry: string): { recordId: string; occurrence: number } {
  const match = /^(.*)~(\d+)$/u.exec(entry);
  return match ? { recordId: match[1]!, occurrence: Math.max(1, Number(match[2])) } : { recordId: entry, occurrence: 1 };
}

/**
 * Deal a 盲盒 set (2026-11, round 4: freshness — "what is the next card?").
 * Two passes: first the sentences with the chosen blanks (`preferred`, by
 * default 未填 / 填错), then — only if the set is still short — the rest
 * (`extra`, e.g. 填对). Within each pass every distinct card comes first, one
 * sentence each, and cards alternate; a card follows itself only when it is
 * the only one left.
 */
export function buildBlindBoxSet(
  cards: ReadonlyArray<{ id: string; preferred: number; extra?: number }>,
  first: string | null,
  count: number,
  random: () => number = Math.random,
): string[] {
  const size = Math.max(0, Math.floor(count));
  const unique = cards.filter((card, index) => cards.findIndex((item) => item.id === card.id) === index);
  const shuffle = <T,>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const value = random();
      const j = Math.floor((Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0) * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  };
  const used = new Map<string, number>();
  const entries: string[] = [];
  let previous: string | null = null;
  const pass = (capacityOf: (card: { preferred: number; extra?: number }) => number, lead: string | null) => {
    const remaining = new Map(unique.map((card) => [card.id, Math.max(0, Math.floor(capacityOf(card)))]));
    for (let round = 0; entries.length < size; round += 1) {
      const roundIds = shuffle(unique.map((card) => card.id).filter((id) => (remaining.get(id) ?? 0) > 0));
      if (!roundIds.length) return;
      if (round === 0 && lead && roundIds.includes(lead)) roundIds.splice(0, roundIds.length, lead, ...roundIds.filter((id) => id !== lead));
      // Keep a round boundary from putting the same card twice in a row.
      if (roundIds.length > 1 && roundIds[0] === previous) [roundIds[0], roundIds[1]] = [roundIds[1]!, roundIds[0]!];
      for (const id of roundIds) {
        if (entries.length >= size) return;
        const occurrence = (used.get(id) ?? 0) + 1;
        used.set(id, occurrence);
        remaining.set(id, remaining.get(id)! - 1);
        entries.push(blindBoxEntryId(id, occurrence));
        previous = id;
      }
    }
  };
  pass((card) => card.preferred, first);
  pass((card) => card.extra ?? 0, entries.length ? null : first);
  return entries;
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

/**
 * How many sentences a card can give (≤ its blanks): `preferred` from the
 * chosen tones, `extra` from the others (used only to fill a short set).
 */
export function blindBoxCapacity(summary: PracticeCounts | null | undefined, tones: readonly BlindBoxTone[] = DEFAULT_BLIND_BOX_TONES): { preferred: number; extra: number } {
  const counts = blindBoxToneCounts(summary);
  if (!counts) {
    // Older summary without counts: assume one unanswered sentence.
    const playable = summary?.status === "clozed" || summary?.status === "completed";
    if (!playable) return { preferred: 0, extra: 0 };
    return tones.includes("unanswered") ? { preferred: 1, extra: 0 } : { preferred: 0, extra: 1 };
  }
  const preferred = tones.reduce((sum, tone) => sum + counts[tone], 0);
  const total = counts.unanswered + counts.incorrect + counts.correct;
  return { preferred, extra: total - preferred };
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
