import assert from "node:assert/strict";
import test from "node:test";
import { segmentLearningSentences } from "./learningSentenceSegmenter.js";

test("does not split decimal-like repeated numbers", () => {
  const text = "Now I'm focusing on nailing it for the 7.7 event. The key is balance.";
  const segments = segmentLearningSentences({
    text,
    languageCode: "en-US",
    minSegmentChars: 1,
    maxSegmentChars: 800,
  });

  assert.deepEqual(segments.map((segment) => segment.text), [
    "Now I'm focusing on nailing it for the 7.7 event.",
    "The key is balance.",
  ]);
});
