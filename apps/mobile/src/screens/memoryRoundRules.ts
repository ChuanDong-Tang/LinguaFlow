import type { CardClozeBlank } from "../services/api/cardApi";

type ClozeRange = Pick<CardClozeBlank, "startUtf16" | "endUtf16">;

export function isDenseMemoryCloze(sentence: string, blanks: ClozeRange[]): boolean {
  const covered = blanks.reduce((sum, blank) => sum + Math.max(0, blank.endUtf16 - blank.startUtf16), 0);
  const ratio = covered / Math.max(1, sentence.length);
  return ratio >= 0.72 || blanks.length >= 3 || (blanks.length >= 2 && ratio >= 0.42);
}

export function sameMemoryLanguageFamily(left: string, right: string): boolean {
  return left.toLocaleLowerCase().split("-")[0] === right.toLocaleLowerCase().split("-")[0];
}

export function canBuildMemorySentencePuzzle(sentence: string): boolean {
  const nonWhitespaceParts = sentence.match(/\S+/gu) ?? [];
  if (nonWhitespaceParts.length >= 2) return true;
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(sentence)
    && Array.from(sentence.trim()).length >= 2;
}

export function memorySentenceTokens(sentence: string): Array<{ id: string; text: string }> {
  const whitespaceParts = sentence.match(/\S+\s*/gu) ?? [];
  let parts = whitespaceParts.length > 1 ? whitespaceParts : Array.from(sentence);
  const leadingWhitespace = sentence.match(/^\s+/u)?.[0] ?? "";
  if (leadingWhitespace && parts.length) parts[0] = `${leadingWhitespace}${parts[0]}`;
  const targetCount = Math.min(9, Math.max(4, Math.ceil(Math.sqrt(parts.length) * 1.7)));
  const groupSize = Math.max(1, Math.ceil(parts.length / targetCount));
  if (groupSize > 1) {
    parts = Array.from(
      { length: Math.ceil(parts.length / groupSize) },
      (_, index) => parts.slice(index * groupSize, (index + 1) * groupSize).join(""),
    );
  }
  return parts.map((text, index) => ({ id: `token-${index}`, text }));
}
