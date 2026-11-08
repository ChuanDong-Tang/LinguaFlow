import assert from "node:assert/strict";
import test from "node:test";
import { deriveCardLearningStatus } from "./cardLearningStatus.ts";

test("card without text is image only", () => {
  assert.equal(deriveCardLearningStatus({ hasText: false, clozeState: null, clozeLastResult: null }), "image_only");
});

test("text without blanks is recorded", () => {
  assert.equal(deriveCardLearningStatus({ hasText: true, clozeState: { blanks: [] }, clozeLastResult: null }), "recorded");
  assert.equal(deriveCardLearningStatus({ hasText: true, clozeState: "bad", clozeLastResult: null }), "recorded");
});

test("blanks not yet mastered are clozed", () => {
  const clozeState = { blanks: [{ id: "a", mastered: true }, { id: "b" }] };
  assert.equal(deriveCardLearningStatus({ hasText: true, clozeState, clozeLastResult: "incorrect" }), "clozed");
});

test("all mastered or last result correct is completed", () => {
  assert.equal(deriveCardLearningStatus({ hasText: true, clozeState: { blanks: [{ mastered: true }] }, clozeLastResult: null }), "completed");
  assert.equal(deriveCardLearningStatus({ hasText: true, clozeState: { blanks: [{ id: "a" }] }, clozeLastResult: "correct" }), "completed");
});
