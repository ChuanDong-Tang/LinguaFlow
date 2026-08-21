import { get_sentence_boundaries } from "sentencex";
import {
  normalizeLearningLanguage,
  segmentLearningSentences as segmentLearningSentencesFallback,
  type LearningSentenceSegment,
  type SegmentLearningSentencesInput,
} from "@lf/core/text/learningText.js";

export const LEARNING_SENTENCE_SEGMENTER_VERSION = "sentencex-1";

export function segmentLearningSentences(input: SegmentLearningSentencesInput): LearningSentenceSegment[] {
  if (normalizeLearningLanguage(input.languageCode) !== "en-US") {
    return segmentLearningSentencesFallback(input);
  }

  const minSegmentChars = Math.max(1, Math.floor(input.minSegmentChars ?? 24));
  const maxSegmentChars = Math.max(minSegmentChars, Math.floor(input.maxSegmentChars ?? 180));
  const natural = sentencexSegments(input.text).flatMap((segment) =>
    splitLongSegment(input.text, segment, maxSegmentChars)
  );
  return mergeShortSegments(input.text, natural, minSegmentChars, maxSegmentChars);
}

function sentencexSegments(sourceText: string): LearningSentenceSegment[] {
  const segments: LearningSentenceSegment[] = [];
  for (const boundary of get_sentence_boundaries("en", sourceText)) {
    // sentencex reports Unicode scalar offsets; JS strings and every persisted
    // card/TTS offset in the app use UTF-16 code units.
    const rawStart = scalarIndexToUtf16(sourceText, boundary.start_index);
    const rawEnd = scalarIndexToUtf16(sourceText, boundary.end_index);
    const textStart = trimStartIndex(sourceText, rawStart, rawEnd);
    const textEnd = trimEndIndex(sourceText, textStart, rawEnd);
    if (textStart < textEnd) {
      segments.push({ text: sourceText.slice(textStart, textEnd), textStart, textEnd });
    }
  }
  if (!segments.length && sourceText.trim()) {
    const textStart = trimStartIndex(sourceText, 0, sourceText.length);
    const textEnd = trimEndIndex(sourceText, textStart, sourceText.length);
    return [{ text: sourceText.slice(textStart, textEnd), textStart, textEnd }];
  }
  return segments;
}

function scalarIndexToUtf16(text: string, scalarIndex: number): number {
  if (scalarIndex <= 0) return 0;
  let scalars = 0;
  let utf16Index = 0;
  for (const character of text) {
    if (scalars >= scalarIndex) break;
    utf16Index += character.length;
    scalars += 1;
  }
  return utf16Index;
}

function splitLongSegment(
  sourceText: string,
  segment: LearningSentenceSegment,
  maxSegmentChars: number
): LearningSentenceSegment[] {
  const output: LearningSentenceSegment[] = [];
  let start = segment.textStart;
  while (segment.textEnd - start > maxSegmentChars) {
    const target = start + maxSegmentChars;
    let split = -1;
    for (let index = target; index > start; index -= 1) {
      if (/[,，:：;；]/u.test(sourceText[index - 1] ?? "")) {
        split = index;
        break;
      }
    }
    if (split < 0) {
      const space = sourceText.lastIndexOf(" ", target);
      split = space >= start ? space + 1 : target;
    }
    pushTrimmed(output, sourceText, start, split);
    start = trimStartIndex(sourceText, split, segment.textEnd);
  }
  pushTrimmed(output, sourceText, start, segment.textEnd);
  return output;
}

function mergeShortSegments(
  sourceText: string,
  segments: LearningSentenceSegment[],
  minSegmentChars: number,
  maxSegmentChars: number
): LearningSentenceSegment[] {
  const merged: LearningSentenceSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.text.length < minSegmentChars && segment.textEnd - previous.textStart <= maxSegmentChars) {
      merged[merged.length - 1] = {
        text: sourceText.slice(previous.textStart, segment.textEnd).trim(),
        textStart: previous.textStart,
        textEnd: segment.textEnd,
      };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}

function pushTrimmed(output: LearningSentenceSegment[], sourceText: string, start: number, end: number): void {
  const textStart = trimStartIndex(sourceText, start, end);
  const textEnd = trimEndIndex(sourceText, textStart, end);
  if (textStart < textEnd) output.push({ text: sourceText.slice(textStart, textEnd), textStart, textEnd });
}

function trimStartIndex(text: string, start: number, end: number): number {
  let index = start;
  while (index < end && /\s/u.test(text[index] ?? "")) index += 1;
  return index;
}

function trimEndIndex(text: string, start: number, end: number): number {
  let index = end;
  while (index > start && /\s/u.test(text[index - 1] ?? "")) index -= 1;
  return index;
}
