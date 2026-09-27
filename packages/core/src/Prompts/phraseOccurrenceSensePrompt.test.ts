import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPhraseOccurrenceSenseEmbeddingInput,
  buildPhraseOccurrenceSensePrompt,
  parsePhraseOccurrenceSenseOutput,
  phraseOccurrenceSensePromptHashInput,
} from "./phraseOccurrenceSensePrompt.js";

const input = {
  languageCode: "en-US",
  canonicalText: "crack up",
  sentence: "I was cracking up.",
  startUtf16: 6,
  endUtf16: 17,
};

test("marks only the selected occurrence and versions the sense prompt", () => {
  const prompt = buildPhraseOccurrenceSensePrompt(input);
  assert.match(prompt.userPrompt, /I was <selected>cracking up<\/selected>\./u);
  assert.match(phraseOccurrenceSensePromptHashInput(input), /^phrase_occurrence_sense_v1\n/u);
});

test("parses one concise usage meaning for embedding", () => {
  const meaning = parsePhraseOccurrenceSenseOutput("<meaning>  laugh   uncontrollably </meaning>");
  assert.equal(meaning, "laugh uncontrollably");
  assert.equal(buildPhraseOccurrenceSenseEmbeddingInput(meaning), "usage meaning: laugh uncontrollably");
});

test("rejects untagged or verbose sense output", () => {
  assert.throws(() => parsePhraseOccurrenceSenseOutput("laugh uncontrollably"), /PHRASE_OCCURRENCE_SENSE_EMPTY/u);
  assert.throws(() => parsePhraseOccurrenceSenseOutput(`<meaning>${"word ".repeat(17)}</meaning>`), /INVALID_LENGTH/u);
});
