import assert from "node:assert/strict";
import test from "node:test";
import { segmentLearningSentences } from "./learningSentenceSegmenter.js";

function split(text: string, options: { minSegmentChars?: number; maxSegmentChars?: number } = {}) {
  return segmentLearningSentences({
    text,
    languageCode: "en-US",
    minSegmentChars: options.minSegmentChars ?? 1,
    maxSegmentChars: options.maxSegmentChars ?? 180,
  });
}

test("does not end a sentence at a.m. before a lowercase continuation", () => {
  const text = "Slept just over three hours, then got up around 5 a.m. and cabbed it to the venue.";
  assert.deepEqual(split(text).map((segment) => segment.text), [text]);
});

test("ends a sentence at a.m. before a new sentence", () => {
  assert.deepEqual(split("I woke at 5 a.m. Then I left.").map((segment) => segment.text), [
    "I woke at 5 a.m.",
    "Then I left.",
  ]);
});

test("handles titles, decimals, URLs, email addresses, and closing quotes", () => {
  const text = 'Dr. Smith paid 3.14 at example.com. Email me@example.com. He said, "Done." Then left.';
  assert.deepEqual(split(text).map((segment) => segment.text), [
    "Dr. Smith paid 3.14 at example.com.",
    "Email me@example.com.",
    'He said, "Done."',
    "Then left.",
  ]);
});

test("returns UTF-16 offsets for text containing emoji", () => {
  const text = "Hi 👋. Next.";
  const segments = split(text);
  assert.deepEqual(segments, [
    { text: "Hi 👋.", textStart: 0, textEnd: 6 },
    { text: "Next.", textStart: 7, textEnd: 12 },
  ]);
  for (const segment of segments) {
    assert.equal(text.slice(segment.textStart, segment.textEnd), segment.text);
  }
});

test("keeps the configured maximum for long sentences", () => {
  const segments = split("one two three four five six seven eight nine ten.", { maxSegmentChars: 12 });
  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => segment.text.length <= 12));
});

test("keeps the existing language-specific fallback for Chinese", () => {
  const text = "第一句。第二句！";
  assert.deepEqual(
    segmentLearningSentences({ text, languageCode: "zh-CN", minSegmentChars: 1 }).map((segment) => segment.text),
    ["第一句。", "第二句！"]
  );
});
