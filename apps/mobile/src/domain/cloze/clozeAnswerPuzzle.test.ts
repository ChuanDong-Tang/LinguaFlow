import assert from "node:assert/strict";
import test from "node:test";
import { buildClozeAnswerPuzzle, clozeAnswerPuzzleText, isClozeAnswerPuzzleCorrect } from "./clozeAnswerPuzzle";

test("short single word reveals its first letter and keeps stable duplicate ids", () => {
  const puzzle = buildClozeAnswerPuzzle("apple", "apple-test");
  assert.equal(puzzle.mode, "characters");
  assert.equal(puzzle.isSingleWord, true);
  assert.equal(puzzle.fixedPrefix, "a");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["p", "p", "l", "e"]);
  assert.equal(new Set(puzzle.target.map((item) => item.id)).size, 4);
  assert.equal(clozeAnswerPuzzleText(puzzle, puzzle.target.map((item) => item.id)), "apple");
  assert.equal(isClozeAnswerPuzzleCorrect(puzzle, puzzle.target.map((item) => item.id)), true);
});

test("multi-word answer is split into word tiles", () => {
  const puzzle = buildClozeAnswerPuzzle("miss out on", "phrase-test");
  assert.equal(puzzle.mode, "words");
  assert.equal(puzzle.isSingleWord, false);
  assert.equal(puzzle.fixedPrefix, "");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["miss", "out", "on"]);
});

test("long character answer fixes the leading graphemes and selects at most the final five", () => {
  const puzzle = buildClozeAnswerPuzzle("cracked", "long-word-test");
  assert.equal(puzzle.mode, "characters");
  assert.equal(puzzle.fixedPrefix, "cr");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["a", "c", "k", "e", "d"]);
  assert.equal(clozeAnswerPuzzleText(puzzle, puzzle.target.map((item) => item.id)), "cracked");
  assert.equal(isClozeAnswerPuzzleCorrect(puzzle, puzzle.target.map((item) => item.id)), true);
});

test("surrounding punctuation does not stop a single word from using the hint rule", () => {
  const puzzle = buildClozeAnswerPuzzle("(cracked!)", "punctuated-word-test");
  assert.equal(puzzle.fixedPrefix, "cr");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["a", "c", "k", "e", "d"]);
});

test("compact-script character puzzle keeps all characters selectable", () => {
  const puzzle = buildClozeAnswerPuzzle("今天晚上吃什么", "long-cjk-test");
  assert.equal(puzzle.mode, "characters");
  assert.equal(puzzle.isSingleWord, false);
  assert.equal(puzzle.fixedPrefix, "");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["今", "天", "晚", "上", "吃", "什", "么"]);
});

test("compact scripts are split into visible characters", () => {
  const puzzle = buildClozeAnswerPuzzle("错过机会", "cjk-test");
  assert.equal(puzzle.mode, "characters");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["错", "过", "机", "会"]);
});

test("combining marks stay attached to their grapheme", () => {
  const puzzle = buildClozeAnswerPuzzle("cafe\u0301", "accent-test");
  assert.equal(puzzle.fixedPrefix, "c");
  assert.deepEqual(puzzle.target.map((item) => item.text), ["a", "f", "e\u0301"]);
});
