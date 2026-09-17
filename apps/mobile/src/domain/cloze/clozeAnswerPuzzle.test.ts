import assert from "node:assert/strict";
import test from "node:test";
import { buildClozeAnswerPuzzle, isClozeAnswerPuzzleCorrect } from "./clozeAnswerPuzzle";

test("single Latin word is split into graphemes with stable duplicate ids", () => {
  const puzzle = buildClozeAnswerPuzzle("apple", "apple-test");
  assert.equal(puzzle.mode, "characters");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["a", "p", "p", "l", "e"]);
  assert.equal(new Set(puzzle.target.map((item) => item.id)).size, 5);
  assert.equal(isClozeAnswerPuzzleCorrect(puzzle, puzzle.target.map((item) => item.id)), true);
});

test("multi-word answer is split into word tiles", () => {
  const puzzle = buildClozeAnswerPuzzle("miss out on", "phrase-test");
  assert.equal(puzzle.mode, "words");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["miss", "out", "on"]);
});

test("compact scripts are split into visible characters", () => {
  const puzzle = buildClozeAnswerPuzzle("错过机会", "cjk-test");
  assert.equal(puzzle.mode, "characters");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["错", "过", "机", "会"]);
});

test("combining marks stay attached to their grapheme", () => {
  const puzzle = buildClozeAnswerPuzzle("cafe\u0301", "accent-test");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["c", "a", "f", "e\u0301"]);
});
