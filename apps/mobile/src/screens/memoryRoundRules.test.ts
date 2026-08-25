import assert from "node:assert/strict";
import test from "node:test";
import {
  canBuildMemorySentencePuzzle,
  isDenseMemoryCloze,
  memorySentenceTokens,
  sameMemoryLanguageFamily,
} from "./memoryRoundRules";

test("a single blank covering most of a sentence becomes a sentence puzzle", () => {
  assert.equal(isDenseMemoryCloze("Remember this phrase", [{ startUtf16: 0, endUtf16: 20 }]), true);
  assert.equal(isDenseMemoryCloze("Remember this phrase", [{ startUtf16: 9, endUtf16: 13 }]), false);
});

test("several clozes become a sentence puzzle", () => {
  assert.equal(isDenseMemoryCloze("one two three four", [
    { startUtf16: 0, endUtf16: 3 },
    { startUtf16: 4, endUtf16: 7 },
    { startUtf16: 8, endUtf16: 13 },
  ]), true);
});

test("a single Latin word does not become a character-order puzzle", () => {
  assert.equal(canBuildMemorySentencePuzzle("remember"), false);
  assert.equal(canBuildMemorySentencePuzzle("remember this"), true);
  assert.equal(canBuildMemorySentencePuzzle("记住这句话"), true);
});

test("language variants can supply distractors to each other", () => {
  assert.equal(sameMemoryLanguageFamily("en-US", "en-GB"), true);
  assert.equal(sameMemoryLanguageFamily("zh-Hans", "en-US"), false);
});

test("sentence tiles reconstruct the exact sentence including outer whitespace", () => {
  const sentence = "  Put this sentence back. ";
  const tokens = memorySentenceTokens(sentence);
  assert.equal(tokens.map((token) => token.text).join(""), sentence);
  assert.ok(tokens.length >= 2);
});
