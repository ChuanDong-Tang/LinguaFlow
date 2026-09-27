import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPhraseOccurrenceContextMeaningEmbeddingInput,
  buildPhraseOccurrenceContextMeaningPrompt,
  buildPhraseOccurrenceSenseEmbeddingInput,
  buildPhraseOccurrenceSensePrompt,
  parsePhraseOccurrenceContextMeaningOutput,
  parsePhraseOccurrenceSenseOutput,
  phraseOccurrenceContextMeaningPromptHashInput,
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

test("V2 captures sentence-scoped polarity and external modality", () => {
  const contextualInput = {
    ...input,
    canonicalText: "really want",
    sentence: "They don't really want to make big changes.",
    startUtf16: 11,
    endUtf16: 22,
  };
  const prompt = buildPhraseOccurrenceContextMeaningPrompt(contextualInput);
  assert.match(prompt.userPrompt, /They don't <selected>really want<\/selected> to make big changes\./u);
  assert.match(prompt.systemPrompt, /operators whose scope includes the selected expression/u);
  assert.match(phraseOccurrenceContextMeaningPromptHashInput(contextualInput), /^phrase_occurrence_context_meaning_v2_1\n/u);

  const result = parsePhraseOccurrenceContextMeaningOutput([
    "<meaning>lack desire to make changes</meaning>",
    "<polarity>negated</polarity>",
    "<modality>plain</modality>",
    "<meaning_kind>process</meaning_kind>",
  ].join("\n"));
  assert.deepEqual(result, {
    meaning: "lack desire to make changes",
    polarity: "negated",
    modality: "plain",
    meaningKind: "process",
  });
  assert.equal(buildPhraseOccurrenceContextMeaningEmbeddingInput(result), [
    "contextual usage meaning: lack desire to make changes",
    "polarity: negated",
    "external modality: plain",
    "meaning kind: process",
  ].join("\n"));
});

test("V2 rejects invalid semantic feature enums", () => {
  assert.throws(() => parsePhraseOccurrenceContextMeaningOutput([
    "<meaning>possibly desire to act</meaning>",
    "<polarity>maybe</polarity>",
    "<modality>possible</modality>",
    "<meaning_kind>process</meaning_kind>",
  ].join("\n")), /POLARITY_INVALID/u);
  assert.throws(() => parsePhraseOccurrenceContextMeaningOutput([
    "<meaning>possibly desire to act</meaning>",
    "<polarity>affirmed</polarity>",
    "<modality>uncertain</modality>",
    "<meaning_kind>process</meaning_kind>",
  ].join("\n")), /MODALITY_INVALID/u);
  assert.throws(() => parsePhraseOccurrenceContextMeaningOutput([
    "<meaning>possibly desire to act</meaning>",
    "<polarity>affirmed</polarity>",
    "<modality>possible</modality>",
    "<meaning_kind>unknown</meaning_kind>",
  ].join("\n")), /MEANING_KIND_INVALID/u);
});

test("V2 normalizes bounded meaning kind aliases", () => {
  assert.equal(parsePhraseOccurrenceContextMeaningOutput([
    "<meaning>continue in a condition</meaning>",
    "<polarity>affirmed</polarity>",
    "<modality>plain</modality>",
    "<meaning_kind>state</meaning_kind>",
  ].join("\n")).meaningKind, "process");
});
