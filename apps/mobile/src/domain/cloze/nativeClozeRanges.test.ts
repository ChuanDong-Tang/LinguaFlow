import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeClozeAnswerRangesForPlatform,
  splitClozeRangesIntoWordRuns,
} from "./nativeClozeRanges.js";

test("splits a wrapped multi-word cloze range without losing its group", () => {
  const text = "missing something, but I just can't figure out what it is";
  assert.deepEqual(
    splitClozeRangesIntoWordRuns(text, [{ start: 8, end: 22, groupIndex: 7 }]),
    [
      { start: 8, end: 18, groupIndex: 7 },
      { start: 19, end: 22, groupIndex: 7 },
    ],
  );
});

test("keeps scripts without whitespace as one visual range", () => {
  assert.deepEqual(
    splitClozeRangesIntoWordRuns("拼象形文字", [{ start: 0, end: 5 }]),
    [{ start: 0, end: 5 }],
  );
});

test("only sends the extra native answer layer to Android", () => {
  const ranges = [{ start: 3, end: 7, text: "this" }];

  assert.deepEqual(nativeClozeAnswerRangesForPlatform("android", ranges), ranges);
  assert.deepEqual(nativeClozeAnswerRangesForPlatform("ios", ranges), []);
});
