import {
  getTargetLanguageProfile,
  targetLanguageOrDefault,
  type TargetLanguageCode,
  type TargetLanguageProfile,
} from "../language/targetLanguages.js";

export type LearningTextLanguage = TargetLanguageCode | "zh-CN" | "zh-TW";

const CHINESE_TEXT_PROFILES: Record<"zh-CN" | "zh-TW", TargetLanguageProfile["text"]> = {
  "zh-CN": {
    compactLineBreaks: true,
    minSegmentChars: 10,
    maxSegmentChars: 120,
    primaryBoundary: /[。！？!?；;]+/g,
    secondaryBoundary: /[，,、：:]/g,
    preferSpaceSplit: false,
  },
  "zh-TW": {
    compactLineBreaks: true,
    minSegmentChars: 10,
    maxSegmentChars: 120,
    primaryBoundary: /[。！？!?；;]+/g,
    secondaryBoundary: /[，,、：:]/g,
    preferSpaceSplit: false,
  },
};

export type NormalizeLearningTextInput = {
  text: string;
  languageCode?: string | null;
};

export type LearningSentenceSegment = {
  text: string;
  textStart: number;
  textEnd: number;
};

export type SegmentLearningSentencesInput = {
  text: string;
  languageCode?: string | null;
  minSegmentChars?: number;
  maxSegmentChars?: number;
};

export function normalizeLearningText(input: NormalizeLearningTextInput): string {
  const language = normalizeLearningLanguage(input.languageCode);
  const profile = learningTextProfile(language);
  let text = stripLearningMarkup(input.text);
  if (profile.compactLineBreaks) {
    text = text.replace(/\r?\n+/g, "");
    text = text.replace(/[ \t\f\v]+/g, " ");
    return text.trim();
  }
  text = text.replace(/\r?\n+/g, " ");
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

export function segmentLearningSentences(input: SegmentLearningSentencesInput): LearningSentenceSegment[] {
  const language = normalizeLearningLanguage(input.languageCode);
  const profile = learningTextProfile(language);
  const minSegmentChars = Math.max(1, Math.floor(input.minSegmentChars ?? profile.minSegmentChars));
  const maxSegmentChars = Math.max(minSegmentChars, Math.floor(input.maxSegmentChars ?? profile.maxSegmentChars));
  const sourceText = input.text;
  const natural = splitByNaturalBoundaries(sourceText, language, maxSegmentChars);
  const merged = mergeShortSegments(natural, minSegmentChars, maxSegmentChars);
  return merged.filter((segment) => segment.text.trim().length > 0);
}

export function normalizeLearningLanguage(languageCode?: string | null): LearningTextLanguage {
  if (languageCode === "zh-CN" || languageCode === "zh-TW") return languageCode;
  return targetLanguageOrDefault(languageCode);
}

export function inferLearningTextLanguage(text: string, fallbackLanguageCode?: string | null): LearningTextLanguage {
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "ja-JP";
  if (/\p{Script=Han}/u.test(text)) return fallbackLanguageCode === "zh-TW" ? "zh-TW" : "zh-CN";
  if (/\p{Script=Latin}/u.test(text)) return "en-US";
  return normalizeLearningLanguage(fallbackLanguageCode);
}

function learningTextProfile(language: LearningTextLanguage): TargetLanguageProfile["text"] {
  return language === "zh-CN" || language === "zh-TW"
    ? CHINESE_TEXT_PROFILES[language]
    : getTargetLanguageProfile(language).text;
}

function stripLearningMarkup(text: string): string {
  return text
    .replace(/<\/?(rewrite|note|reply|en|zh|cn)>/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "");
}

function splitByNaturalBoundaries(
  text: string,
  language: LearningTextLanguage,
  maxSegmentChars: number
): LearningSentenceSegment[] {
  const primary = cloneGlobalRegExp(learningTextProfile(language).primaryBoundary);
  const segments: LearningSentenceSegment[] = [];
  let start = 0;
  for (const match of text.matchAll(primary)) {
    const end = (match.index ?? 0) + match[0].length;
    pushSegmentParts(segments, text, start, end, language, maxSegmentChars);
    start = end;
    while (text[start] === " ") start += 1;
  }
  if (start < text.length) {
    pushSegmentParts(segments, text, start, text.length, language, maxSegmentChars);
  }
  return segments;
}

function pushSegmentParts(
  output: LearningSentenceSegment[],
  sourceText: string,
  start: number,
  end: number,
  language: LearningTextLanguage,
  maxSegmentChars: number
): void {
  let currentStart = trimStartIndex(sourceText, start, end);
  const finalEnd = trimEndIndex(sourceText, currentStart, end);
  if (currentStart >= finalEnd) return;

  while (finalEnd - currentStart > maxSegmentChars) {
    const split = findSplitIndex(sourceText, currentStart, finalEnd, language, maxSegmentChars);
    if (split <= currentStart || split >= finalEnd) break;
    pushTrimmed(output, sourceText, currentStart, split);
    currentStart = trimStartIndex(sourceText, split, finalEnd);
  }
  pushTrimmed(output, sourceText, currentStart, finalEnd);
}

function findSplitIndex(
  text: string,
  start: number,
  end: number,
  language: LearningTextLanguage,
  maxSegmentChars: number
): number {
  const target = Math.min(end, start + maxSegmentChars);
  const profile = learningTextProfile(language);
  const secondary = cloneGlobalRegExp(profile.secondaryBoundary);
  let best = -1;
  const slice = text.slice(start, target);
  for (const match of slice.matchAll(secondary)) {
    best = start + (match.index ?? 0) + match[0].length;
  }
  if (best > start) return best;

  if (profile.preferSpaceSplit) {
    const space = text.lastIndexOf(" ", target);
    if (space > start) return space + 1;
  }
  return target;
}

function cloneGlobalRegExp(value: RegExp): RegExp {
  return new RegExp(value.source, value.flags.includes("g") ? value.flags : `${value.flags}g`);
}

function mergeShortSegments(
  segments: LearningSentenceSegment[],
  minSegmentChars: number,
  maxSegmentChars: number
): LearningSentenceSegment[] {
  const merged: LearningSentenceSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.text.length < minSegmentChars &&
      segment.textEnd - previous.textStart <= maxSegmentChars
    ) {
      merged[merged.length - 1] = {
        text: segment.textStart > previous.textEnd
          ? `${previous.text} ${segment.text}`
          : previous.text + segment.text,
        textStart: previous.textStart,
        textEnd: segment.textEnd,
      };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function pushTrimmed(output: LearningSentenceSegment[], sourceText: string, start: number, end: number): void {
  const textStart = trimStartIndex(sourceText, start, end);
  const textEnd = trimEndIndex(sourceText, textStart, end);
  if (textStart >= textEnd) return;
  output.push({
    text: sourceText.slice(textStart, textEnd),
    textStart,
    textEnd,
  });
}

function trimStartIndex(text: string, start: number, end: number): number {
  let index = start;
  while (index < end && /\s/.test(text[index] ?? "")) index += 1;
  return index;
}

function trimEndIndex(text: string, start: number, end: number): number {
  let index = end;
  while (index > start && /\s/.test(text[index - 1] ?? "")) index -= 1;
  return index;
}
