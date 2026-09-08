import { normalizeLearningText } from "./learningText.js";

export type CardSpeechSegment = {
  segmentId: string;
  text: string;
  textStart: number;
  textEnd: number;
};
export type CardSpeechSentenceMark = {
  segmentId?: string;
  text: string;
  textStart: number;
  textEnd: number;
  startMs: number;
  durationMs: number;
};

/** Preserve the persisted Card rows: speech must never run a second sentence splitter. */
export function buildCardSpeechText(rows: Array<{ id: string; text: string }>, languageCode: string): {
  sourceText: string;
  sentenceSegments: CardSpeechSegment[];
} | null {
  const normalized = rows.map((row) => ({ ...row, text: normalizeLearningText({ text: row.text, languageCode }) }));
  if (!normalized.length || normalized.some((row) => !row.text)) return null;
  const sourceText = normalizeLearningText({ text: normalized.map((row) => row.text).join("\n\n"), languageCode });
  const sentenceSegments: CardSpeechSegment[] = [];
  let cursor = 0;
  for (const row of normalized) {
    const textStart = sourceText.indexOf(row.text, cursor);
    if (textStart < 0) return null;
    const textEnd = textStart + row.text.length;
    sentenceSegments.push({ segmentId: row.id, text: row.text, textStart, textEnd });
    cursor = textEnd;
  }
  return { sourceText, sentenceSegments };
}

/** Match by text and identity, also joining split marks from older servers. */
export function alignCardSpeechMarks(
  rows: Array<{ id: string; text: string }>,
  marks: CardSpeechSentenceMark[],
  languageCode: string,
): CardSpeechSentenceMark[] | null {
  if (!rows.length || !marks.length) return null;
  if (marks.some((mark, index) => !Number.isFinite(mark.startMs) || mark.startMs < 0
    || !Number.isFinite(mark.durationMs) || mark.durationMs <= 0
    || index > 0 && mark.startMs < marks[index - 1]!.startMs)) return null;
  const comparisonText = (text: string) => normalizeLearningText({ text, languageCode }).normalize("NFKC").replace(/\s+/gu, "");
  let cursor = 0;
  const aligned: CardSpeechSentenceMark[] = [];
  for (const row of rows) {
    const expected = comparisonText(row.text);
    const first = marks[cursor];
    if (!expected || !first) return null;
    let text = "";
    let last = first;
    while (cursor < marks.length && text !== expected) {
      const mark = marks[cursor]!;
      if (mark.segmentId && mark.segmentId !== row.id) return null;
      text += comparisonText(mark.text);
      if (!expected.startsWith(text)) return null;
      last = mark;
      cursor += 1;
    }
    if (text !== expected) return null;
    aligned.push({
      segmentId: row.id, text: row.text,
      textStart: first.textStart, textEnd: last.textEnd,
      startMs: first.startMs, durationMs: last.startMs + last.durationMs - first.startMs,
    });
  }
  return cursor === marks.length ? aligned : null;
}
