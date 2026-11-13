import assert from "node:assert/strict";
import test from "node:test";
import { practiceStats } from "./practiceStats.js";

const day = (n: number) => new Date(Date.UTC(2026, 10, n));

test("weak words rank still-wrong first, then by misses, merged across cards", () => {
  const stats = practiceStats([
    { cardId: "a", title: "A", updatedAt: day(10), clozeState: { blanks: [
      { id: "1", answer: "milestone", attempts: 2, correctCount: 0, lastResult: "incorrect" },
      { id: "2", answer: "way too", attempts: 3, correctCount: 1, lastResult: "correct" },
      { id: "3", answer: "handover" },
    ] } },
    { cardId: "b", title: "B", updatedAt: day(12), clozeState: { blanks: [
      { id: "4", answer: "Way too", attempts: 2, correctCount: 1, lastResult: "correct" },
      { id: "5", answer: "keys", attempts: 1, correctCount: 1, lastResult: "correct", mastered: true },
    ] } },
  ]);
  assert.deepEqual(stats.weakWords.map((word) => [word.answer, word.misses, word.stillWrong, word.cardIds]), [
    ["milestone", 2, true, ["a"]],
    ["Way too", 3, false, ["b", "a"]],
  ]);
  assert.equal(stats.blanksAnswered, 4);
  assert.equal(stats.accuracy, 75);
  assert.equal(stats.cardsPracticed, 2);
  assert.deepEqual(stats.cardsWithMistakes, [{ cardId: "a", title: "A", wrongBlanks: 1 }]);
});

test("since filters by when the card was last practiced", () => {
  const stats = practiceStats([
    { cardId: "old", title: "", updatedAt: day(1), clozeState: { blanks: [{ id: "1", answer: "x", attempts: 1, correctCount: 0, lastResult: "incorrect" }] } },
  ], { since: day(5) });
  assert.equal(stats.blanksAnswered, 0);
  assert.equal(stats.accuracy, null);
  assert.deepEqual(stats.weakWords, []);
});
