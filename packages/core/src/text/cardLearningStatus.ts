// Where a card is in the learning loop, shown as a badge on home cards.
// image_only: photo saved without words yet; recorded: words, no blanks;
// clozed: has blanks; completed: every blank mastered or last cloze correct.
export type CardLearningStatus = "image_only" | "recorded" | "clozed" | "completed";

export function deriveCardLearningStatus(input: {
  hasText: boolean;
  clozeState: unknown;
  clozeLastResult: string | null | undefined;
}): CardLearningStatus {
  if (!input.hasText) return "image_only";
  const blanks = clozeBlanks(input.clozeState);
  if (!blanks.length) return "recorded";
  if (input.clozeLastResult === "correct" || blanks.every((blank) => blank.mastered === true)) return "completed";
  return "clozed";
}

function clozeBlanks(state: unknown): Array<{ mastered?: unknown }> {
  if (!state || typeof state !== "object") return [];
  const blanks = (state as { blanks?: unknown }).blanks;
  return Array.isArray(blanks) ? blanks.filter((blank): blank is { mastered?: unknown } => Boolean(blank) && typeof blank === "object") : [];
}
