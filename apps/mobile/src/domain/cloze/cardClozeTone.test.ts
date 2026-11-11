import assert from "node:assert/strict";
import test from "node:test";
import { cardClozeBlankTone, cardClozeSessionSummary } from "./cardClozeCorrectness";

test("session answer wins, then redo, then the remembered result", () => {
  const green = { id: "a", lastResult: "correct" as const };
  assert.equal(cardClozeBlankTone(green, {}), "correct");
  assert.equal(cardClozeBlankTone(green, {}, new Set(["a"])), "unanswered");
  assert.equal(cardClozeBlankTone(green, { a: "incorrect" }, new Set(["a"])), "incorrect");
  assert.equal(cardClozeBlankTone({ id: "b", mastered: true }, {}), "correct");
  assert.equal(cardClozeBlankTone({ id: "c" }, {}), "unanswered");
});

test("summary lists right and wrong blanks with accuracy", () => {
  const blanks = [
    { id: "a", answer: "take off", lastResult: "correct" as const },
    { id: "b", answer: "run into" },
    { id: "c", answer: "pick up" },
  ];
  assert.deepEqual(cardClozeSessionSummary(blanks, { b: "incorrect" }), {
    accuracy: 50,
    correct: [{ blankId: "a", answer: "take off" }],
    incorrect: [{ blankId: "b", answer: "run into" }],
  });
  assert.equal(cardClozeSessionSummary([{ id: "x", answer: "x" }], {}), null);
});
