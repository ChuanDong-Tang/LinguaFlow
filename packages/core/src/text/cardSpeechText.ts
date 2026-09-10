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
  allowPartial = false,
): CardSpeechSentenceMark[] | null {
  if (!rows.length) return null;
  if (!marks.length) return allowPartial ? [] : null;
  if (marks.some((mark, index) => !Number.isFinite(mark.startMs) || mark.startMs < 0
    || !Number.isFinite(mark.durationMs) || mark.durationMs <= 0
    || index > 0 && mark.startMs < marks[index - 1]!.startMs)) return null;
  // Current assets carry the persisted Card segment id. It is the stable
  // identity for a timeline: original Card rows may contain bilingual text,
  // while TTS intentionally synthesizes and returns only the target-language
  // part. Comparing those two text representations would reject a valid asset.
  if (marks.every((mark) => Boolean(mark.segmentId))) {
    let cursor = 0;
    const aligned: CardSpeechSentenceMark[] = [];
    for (const row of rows) {
      const first = marks[cursor];
      if (!first) return allowPartial ? aligned : null;
      if (first.segmentId !== row.id) return null;
      let last = first;
      cursor += 1;
      while (cursor < marks.length && marks[cursor]!.segmentId === row.id) {
        last = marks[cursor]!;
        cursor += 1;
      }
      aligned.push({
        segmentId: row.id, text: row.text,
        textStart: first.textStart, textEnd: last.textEnd,
        startMs: first.startMs, durationMs: last.startMs + last.durationMs - first.startMs,
      });
    }
    return cursor === marks.length ? aligned : null;
  }

  // Assets created before segment ids were persisted still need text matching.
  const comparisonText = (text: string) => normalizeLearningText({ text, languageCode }).normalize("NFKC").replace(/\s+/gu, "");
  let cursor = 0;
  const aligned: CardSpeechSentenceMark[] = [];
  for (const row of rows) {
    const expected = comparisonText(row.text);
    const first = marks[cursor];
    if (!expected) return null;
    if (!first) return allowPartial ? aligned : null;
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
    if (text !== expected) return allowPartial && expected.startsWith(text) ? aligned : null;
    aligned.push({
      segmentId: row.id, text: row.text,
      textStart: first.textStart, textEnd: last.textEnd,
      startMs: first.startMs, durationMs: last.startMs + last.durationMs - first.startMs,
    });
  }
  return cursor === marks.length ? aligned : null;
}
