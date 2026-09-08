import { segmentLearningSentences } from "./learningText.js";
import { isTargetLanguageCode } from "../language/targetLanguages.js";

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
    const classification = classifyCorpusSentence(sentence, languageCode);
    if (classification === "target") kept.push(sentence);
    else if (classification === "other") excludedSentences.push(sentence);
  }
  return { text: kept.join("\n"), sentences: kept, excludedSentences };
}

function classifyCorpusSentence(sentence: string, languageCode: string): "target" | "other" | "neutral" {
  if (!isTargetLanguageCode(languageCode)) return "other";
  const letters = [...sentence.matchAll(/\p{Letter}/gu)].map((match) => match[0]);
  if (!letters.length) return "neutral";
  const latin = letters.filter((letter) => /\p{Script=Latin}/u.test(letter)).length;
  const han = letters.filter((letter) => /\p{Script=Han}/u.test(letter)).length;
  const kana = letters.filter((letter) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(letter)).length;
  const japanese = han + kana;
  const other = Math.max(0, letters.length - latin - kana - han);
  if (languageCode === "en-US") {
    // Permit occasional names or borrowed words from another script, while a
    // clearly non-Latin sentence is still filtered out.
    return latin > 0 && latin >= (japanese + other) * 2 ? "target" : "other";
  }
  // Kana is the reliable Japanese signal. Latin product names are common in
  // otherwise Japanese sentences, so only treat them as foreign when dominant.
  return kana > 0 && japanese >= (latin + other) ? "target" : "other";
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
