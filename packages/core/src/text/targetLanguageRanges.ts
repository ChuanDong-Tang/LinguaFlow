import { isTargetLanguageCode, type TargetLanguageCode } from "../language/targetLanguages.js";

export type TargetLanguageRange = {
  startUtf16: number;
  endUtf16: number;
  text: string;
};

/**
 * Finds conservative, script-bounded target-language islands in mixed text.
 * The returned offsets always refer to the original UTF-16 string.
 */
export function findTargetLanguageRanges(text: string, languageCode: string): TargetLanguageRange[] {
  if (!isTargetLanguageCode(languageCode)) return [];
  const pattern = languageCode === "en-US"
    ? /\p{Script=Latin}(?:[\p{Script=Latin}\p{Number}\p{Mark}\p{Punctuation} \t]*\p{Script=Latin})?/gu
    : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}](?:[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Number}\p{Mark}ー々〆ヵヶ \t]*)/gu;
  return [...text.matchAll(pattern)].flatMap((match) => {
    const value = match[0] ?? "";
    const start = match.index ?? -1;
    if (start < 0 || !isReliableTargetLanguageText(value, languageCode)) return [];
    return [{ startUtf16: start, endUtf16: start + value.length, text: value }];
  });
}

export function isReliableTargetLanguageText(text: string, languageCode: string): boolean {
  if (!isTargetLanguageCode(languageCode)) return false;
  if (languageCode === "en-US") {
    const latin = countMatches(text, /\p{Script=Latin}/gu);
    return latin >= 2 && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
  }
  const kana = countMatches(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const han = countMatches(text, /\p{Script=Han}/gu);
  return kana >= 1 && han <= kana * 4 + 4 && !/\p{Script=Latin}/u.test(text);
}

export function targetLanguageTextOnly(text: string, languageCode: string): { text: string; languageCode: TargetLanguageCode } | null {
  if (!isTargetLanguageCode(languageCode)) return null;
  const ranges = findTargetLanguageRanges(text, languageCode);
  if (!ranges.length) return null;
  return { text: ranges.map((range) => range.text.trim()).filter(Boolean).join("\n\n"), languageCode };
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}
