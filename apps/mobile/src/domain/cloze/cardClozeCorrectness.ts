export function isCardClozeBlankCorrect(
  blank: { id: string; mastered?: boolean },
  checkedAnswers: Readonly<Record<string, "correct" | "incorrect">>,
): boolean {
  return blank.mastered === true || checkedAnswers[blank.id] === "correct";
}
