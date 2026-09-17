export type ClozeAnswerPuzzleMode = "characters" | "words";

export type ClozeAnswerPuzzleToken = {
  id: string;
  text: string;
};

export type ClozeAnswerPuzzle = {
  mode: ClozeAnswerPuzzleMode;
  target: ClozeAnswerPuzzleToken[];
  shuffled: ClozeAnswerPuzzleToken[];
};

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const COMPACT_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function buildClozeAnswerPuzzle(answer: string, seed = answer): ClozeAnswerPuzzle {
  const words = answer.match(WORD_PATTERN) ?? [];
  const mode: ClozeAnswerPuzzleMode = COMPACT_SCRIPT_PATTERN.test(answer) || words.length <= 1
    ? "characters"
    : "words";
  const values = mode === "words"
    ? words
    : graphemes(words.length === 1 ? words[0]! : answer).filter((value) => /[\p{L}\p{M}\p{N}]/u.test(value));
  const safeValues = values.length ? values : graphemes(answer).filter((value) => value.trim());
  const target = safeValues.map((text, index) => ({ id: `answer-unit-${index}`, text }));
  return { mode, target, shuffled: seededShuffle(target, seed) };
}

export function isClozeAnswerPuzzleComplete(puzzle: ClozeAnswerPuzzle, selectedIds: string[]): boolean {
  return selectedIds.length === puzzle.target.length;
}

export function isClozeAnswerPuzzleCorrect(puzzle: ClozeAnswerPuzzle, selectedIds: string[]): boolean {
  if (!isClozeAnswerPuzzleComplete(puzzle, selectedIds)) return false;
  const byId = new Map(puzzle.target.map((token) => [token.id, token]));
  return selectedIds.every((id, index) => normalizePuzzleUnit(byId.get(id)?.text ?? "") === normalizePuzzleUnit(puzzle.target[index]?.text ?? ""));
}

export function clozeAnswerPuzzleText(puzzle: ClozeAnswerPuzzle, selectedIds: string[]): string {
  const byId = new Map(puzzle.target.map((token) => [token.id, token]));
  return selectedIds.map((id) => byId.get(id)?.text ?? "").join(puzzle.mode === "words" ? " " : "");
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter !== "function") return Array.from(value);
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((item) => item.segment);
}

function normalizePuzzleUnit(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function seededShuffle<T>(values: T[], seedValue: string): T[] {
  const shuffled = [...values];
  let seed = Array.from(seedValue).reduce((sum, character) => (sum * 31 + (character.codePointAt(0) ?? 0)) >>> 0, 7);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  if (shuffled.length > 1 && shuffled.every((token, index) => token === values[index])) {
    shuffled.push(shuffled.shift()!);
  }
  return shuffled;
}
