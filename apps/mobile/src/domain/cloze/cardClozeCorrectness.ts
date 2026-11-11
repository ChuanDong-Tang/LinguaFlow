export function isCardClozeBlankCorrect(
  blank: { id: string; mastered?: boolean },
  checkedAnswers: Readonly<Record<string, "correct" | "incorrect">>,
): boolean {
  return blank.mastered === true || checkedAnswers[blank.id] === "correct";
}

export function isCardClozeBlankAnsweredThisSession(
  blank: { id: string },
  checkedAnswers: Readonly<Record<string, "correct" | "incorrect">>,
): boolean {
  return checkedAnswers[blank.id] === "correct";
}

export function shouldMaskCardClozeBlank(
  blank: { id: string },
  checkedAnswers: Readonly<Record<string, "correct" | "incorrect">>,
  revealed: boolean,
): boolean {
  return !revealed && !isCardClozeBlankAnsweredThisSession(blank, checkedAnswers);
}

export type CardClozeBlankTone = "unanswered" | "correct" | "incorrect";

/**
 * Color of a blank (2026-11 grading): this session's answer wins; otherwise the
 * remembered latest answer (green / yellow), unless the user chose to redo it.
 */
export function cardClozeBlankTone(
  blank: { id: string; mastered?: boolean; lastResult?: "correct" | "incorrect" },
  checkedAnswers: Readonly<Record<string, "correct" | "incorrect">>,
  redoBlankIds: ReadonlySet<string> = new Set(),
): CardClozeBlankTone {
  const session = checkedAnswers[blank.id];
  if (session) return session;
  if (redoBlankIds.has(blank.id)) return "unanswered";
  if (blank.lastResult === "correct" || blank.lastResult === "incorrect") return blank.lastResult;
  return blank.mastered === true ? "correct" : "unanswered";
}

export type CardClozeSessionSummary = {
  accuracy: number;
  correct: Array<{ blankId: string; answer: string }>;
  incorrect: Array<{ blankId: string; answer: string }>;
};

/** End-of-card summary: every blank counts, by its current tone; unanswered ones are skipped. */
export function cardClozeSessionSummary(
  blanks: ReadonlyArray<{ id: string; answer: string; mastered?: boolean; lastResult?: "correct" | "incorrect" }>,
  checkedAnswers: Readonly<Record<string, "correct" | "incorrect">>,
  redoBlankIds: ReadonlySet<string> = new Set(),
): CardClozeSessionSummary | null {
  const correct: CardClozeSessionSummary["correct"] = [];
  const incorrect: CardClozeSessionSummary["incorrect"] = [];
  for (const blank of blanks) {
    const tone = cardClozeBlankTone(blank, checkedAnswers, redoBlankIds);
    if (tone === "correct") correct.push({ blankId: blank.id, answer: blank.answer });
    else if (tone === "incorrect") incorrect.push({ blankId: blank.id, answer: blank.answer });
  }
  const answered = correct.length + incorrect.length;
  if (!answered) return null;
  return { accuracy: Math.round((correct.length / answered) * 100), correct, incorrect };
}
