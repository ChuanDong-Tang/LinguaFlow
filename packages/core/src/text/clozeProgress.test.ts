import assert from "node:assert/strict";
import test from "node:test";
import { clozeBlankTone, clozeProgress, recordClozeAttempt } from "./clozeProgress.ts";

test("blank tone follows the latest answer; legacy mastered counts as correct", () => {
  assert.equal(clozeBlankTone({ id: "a" }), "unanswered");
  assert.equal(clozeBlankTone({ id: "a", mastered: true }), "correct");
  assert.equal(clozeBlankTone({ id: "a", mastered: true, lastResult: "incorrect" }), "incorrect");
});

test("recording attempts keeps counts and masters on correct", () => {
  const blanks: Array<{ id: string; mastered?: boolean; lastResult?: string; attempts?: number; correctCount?: number }> = [{ id: "a" }];
  recordClozeAttempt(blanks, "a", false);
  assert.deepEqual(blanks[0], { id: "a", lastResult: "incorrect", attempts: 1, correctCount: 0 });
  recordClozeAttempt(blanks, "a", true);
  assert.deepEqual(blanks[0], { id: "a", lastResult: "correct", attempts: 2, correctCount: 1, mastered: true });
  assert.equal(recordClozeAttempt(blanks, "missing", true), null);
});

test("accuracy is over answered blanks", () => {
  assert.deepEqual(clozeProgress(null), { totalBlanks: 0, answeredBlanks: 0, correctBlanks: 0, accuracy: null });
  const state = { blanks: [{ id: "a", lastResult: "correct" }, { id: "b", lastResult: "incorrect" }, { id: "c" }, { id: "d", mastered: true }] };
  assert.deepEqual(clozeProgress(state), { totalBlanks: 4, answeredBlanks: 3, correctBlanks: 2, accuracy: 67 });
});
