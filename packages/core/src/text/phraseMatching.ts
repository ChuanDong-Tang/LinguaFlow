import { getTargetLanguageProfile } from "../language/targetLanguages.js";

export interface PhraseTextMatch {
  startUtf16: number;
  endUtf16: number;
  surfaceText: string;
}

/** Literal variant matching. The returned offsets always address the original JS string (UTF-16). */
export function findPhraseMatches(text: string, variants: string[], languageCode: string): PhraseTextMatch[] {
  const profile = getTargetLanguageProfile(languageCode);
  const candidates: PhraseTextMatch[] = [];
  const seenVariants = new Set<string>();
  for (const rawVariant of variants) {
    const variant = rawVariant.trim();
    const variantKey = profile.matcher.caseInsensitive
      ? variant.toLocaleLowerCase(profile.matcher.caseLocale)
      : variant;
    if (!variantKey || seenVariants.has(variantKey)) continue;
    seenVariants.add(variantKey);
    const flags = profile.matcher.caseInsensitive ? "giu" : "gu";
    const expression = new RegExp(escapeRegExp(variant), flags);
    for (const match of text.matchAll(expression)) {
      const startUtf16 = match.index;
      const endUtf16 = startUtf16 + match[0].length;
      if (profile.matcher.tokenBoundary && !hasTokenBoundaries(text, startUtf16, endUtf16)) continue;
      candidates.push({ startUtf16, endUtf16, surfaceText: match[0] });
    }
  }
  candidates.sort((left, right) => left.startUtf16 - right.startUtf16 || right.endUtf16 - left.endUtf16);
  const accepted: PhraseTextMatch[] = [];
  for (const candidate of candidates) {
    if (accepted.some((item) => candidate.startUtf16 < item.endUtf16 && candidate.endUtf16 > item.startUtf16)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

function hasTokenBoundaries(text: string, startUtf16: number, endUtf16: number): boolean {
  const previous = codePointBefore(text, startUtf16);
  const next = codePointAt(text, endUtf16);
  return !isWordCharacter(previous) && !isWordCharacter(next);
}

function codePointBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const tail = text.slice(0, index);
  return Array.from(tail).at(-1) ?? "";
}

function codePointAt(text: string, index: number): string {
  return Array.from(text.slice(index))[0] ?? "";
}

function isWordCharacter(value: string): boolean {
  return value ? /[\p{L}\p{N}_]/u.test(value) : false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
