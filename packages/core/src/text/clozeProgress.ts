// Per-blank answer memory and card accuracy (2026-11 grading redesign).
// A blank is "correct" (green) or "incorrect" (yellow) after its latest
// answer, and "unanswered" (gray) until then.

export type ClozeBlankTone = "unanswered" | "correct" | "incorrect";

type BlankLike = { id: string; mastered?: unknown; lastResult?: unknown; attempts?: unknown; correctCount?: unknown };

export function clozeBlankTone(blank: BlankLike): ClozeBlankTone {
  if (blank.lastResult === "correct" || blank.lastResult === "incorrect") return blank.lastResult;
  // Blanks mastered before per-blank results existed count as answered right.
  return blank.mastered === true ? "correct" : "unanswered";
}

/** Record one graded answer on the blank in place; correct answers also master it. */
export function recordClozeAttempt<T extends BlankLike>(blanks: T[], blankId: string, correct: boolean): T | null {
  const blank = blanks.find((candidate) => candidate.id === blankId);
  if (!blank) return null;
  blank.lastResult = correct ? "correct" : "incorrect";
  blank.attempts = (Number(blank.attempts) || 0) + 1;
  blank.correctCount = (Number(blank.correctCount) || 0) + (correct ? 1 : 0);
  if (correct) blank.mastered = true;
  return blank;
}

export type ClozeProgress = {
  totalBlanks: number;
  answeredBlanks: number;
  correctBlanks: number;
  /** 0–100 over answered blanks; null until any blank is answered. */
  accuracy: number | null;
};

export function clozeProgress(state: unknown): ClozeProgress {
  const blanks = blanksOf(state);
  let answeredBlanks = 0;
  let correctBlanks = 0;
  for (const blank of blanks) {
    const tone = clozeBlankTone(blank);
    if (tone === "unanswered") continue;
    answeredBlanks += 1;
    if (tone === "correct") correctBlanks += 1;
  }
  return {
    totalBlanks: blanks.length,
    answeredBlanks,
    correctBlanks,
    accuracy: answeredBlanks ? Math.round((correctBlanks / answeredBlanks) * 100) : null,
  };
}

function blanksOf(state: unknown): BlankLike[] {
  const blanks = state && typeof state === "object" ? (state as { blanks?: unknown }).blanks : null;
  return Array.isArray(blanks)
    ? blanks.filter((blank): blank is BlankLike => Boolean(blank) && typeof blank === "object" && typeof (blank as BlankLike).id === "string")
    : [];
}
