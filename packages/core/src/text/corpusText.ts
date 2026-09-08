import { segmentLearningSentences } from "./learningText.js";
import { isEntireTargetLanguageText } from "./targetLanguageRanges.js";

export type TargetLanguageCorpusExtraction = {
  text: string;
  sentences: string[];
  excludedSentences: string[];
};

/** Splits imported material and keeps only complete target-language sentences. */
export function extractTargetLanguageCorpus(text: string, languageCode: string): TargetLanguageCorpusExtraction {
  const sentences = text
    .replace(/\r\n?/gu, "\n")
    .split(/\n+/gu)
    .flatMap(splitUniversalSentences)
    .flatMap((sentence) => segmentLearningSentences({
      text: sentence,
      languageCode,
      minSegmentChars: 1,
      maxSegmentChars: 800,
    }).map((segment) => segment.text.trim()))
    .filter(Boolean);
  const kept: string[] = [];
  const excludedSentences: string[] = [];
  for (const sentence of sentences) {
    if (isEntireTargetLanguageText(sentence, languageCode)) kept.push(sentence);
    else if (/\p{Letter}/u.test(sentence)) excludedSentences.push(sentence);
  }
  return { text: kept.join("\n"), sentences: kept, excludedSentences };
}

function splitUniversalSentences(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/[.!?;。！？；]+/gu)) {
    const end = (match.index ?? 0) + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) result.push(sentence);
    start = end;
  }
  const remainder = text.slice(start).trim();
  if (remainder) result.push(remainder);
  return result;
}
