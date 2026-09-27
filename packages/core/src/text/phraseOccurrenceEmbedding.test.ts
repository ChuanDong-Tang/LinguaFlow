import assert from "node:assert/strict";
import test from "node:test";
import { buildPhraseOccurrenceEmbeddingInput } from "./phraseOccurrenceEmbedding.js";

test("marks the exact phrase occurrence inside its sentence", () => {
  const sentence = "So ridiculous, I was cracking up.";
  const startUtf16 = sentence.indexOf("cracking up");
  assert.equal(buildPhraseOccurrenceEmbeddingInput({
    languageCode: "en-US",
    canonicalText: "crack up",
    sentence,
    startUtf16,
    endUtf16: startUtf16 + "cracking up".length,
  }), [
    "language: en-US",
    "phrase: crack up",
    "sentence: So ridiculous, I was <phrase>cracking up</phrase>.",
  ].join("\n"));
});

test("rejects a stale range outside the sentence", () => {
  assert.equal(buildPhraseOccurrenceEmbeddingInput({
    languageCode: "en-US",
    canonicalText: "crack",
    sentence: "It cracked.",
    startUtf16: 20,
    endUtf16: 25,
  }), null);
});
