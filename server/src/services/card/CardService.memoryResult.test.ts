import assert from "node:assert/strict";
import test from "node:test";
import type { CardClozeState } from "@lf/core/types/cardRecord.js";
import { CardPracticeConflictError, markMemoryResultBlanks } from "./CardService.js";

function state(): CardClozeState {
  return {
    schemaVersion: 1,
    blanks: [
      { id: "a", segmentId: "s", startUtf16: 0, endUtf16: 3, answer: "one" },
      { id: "b", segmentId: "s", startUtf16: 4, endUtf16: 7, answer: "two" },
    ],
  };
}

test("memory result masters every blank represented by a sentence puzzle", () => {
  const value = state();
  markMemoryResultBlanks(value, ["a", "b"]);
  assert.deepEqual(value.blanks.map((blank) => blank.mastered), [true, true]);
});

test("stale memory result rejects before mutating any blank", () => {
  const value = state();
  assert.throws(() => markMemoryResultBlanks(value, ["a", "missing"]), CardPracticeConflictError);
  assert.deepEqual(value.blanks.map((blank) => blank.mastered), [undefined, undefined]);
});
