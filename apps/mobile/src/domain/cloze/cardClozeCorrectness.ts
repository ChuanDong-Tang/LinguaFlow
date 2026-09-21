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
