import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPhraseRelationJudgePrompt,
  parsePhraseRelationJudgeOutput,
  phraseRelationJudgeHashInput,
  type PhraseRelationJudgeSource,
} from "./phraseRelationJudgePrompt.js";

const source: PhraseRelationJudgeSource = {
  userId: "user-1",
  anchor: { occurrenceId: "anchor", languageCode: "en", surfaceText: "cracking up", sentence: "I was cracking up.", startUtf16: 6, endUtf16: 17 },
  candidates: [
    { occurrenceId: "candidate-1", languageCode: "en", surfaceText: "burst out laughing", sentence: "I burst out laughing.", startUtf16: 2, endUtf16: 20, semanticScore: 0.91 },
    { occurrenceId: "candidate-2", languageCode: "en", surfaceText: "cracked", sentence: "The screen cracked.", startUtf16: 11, endUtf16: 18, semanticScore: 0.88 },
  ],
};

describe("phraseRelationJudgePrompt", () => {
  it("marks the compared expressions and hashes deterministically", () => {
    const prompt = buildPhraseRelationJudgePrompt(source);
    assert.match(prompt.userPrompt, /<selected>cracking up<\/selected>/u);
    assert.match(prompt.userPrompt, /candidate_2: The screen <selected>cracked<\/selected>\./u);
    assert.equal(phraseRelationJudgeHashInput(source), phraseRelationJudgeHashInput(source));
  });

  it("accepts one candidate or none and rejects invalid choices", () => {
    assert.deepEqual(parsePhraseRelationJudgeOutput("<choice>candidate_1</choice>", source.candidates), { selectedOccurrenceId: "candidate-1" });
    assert.deepEqual(parsePhraseRelationJudgeOutput("<choice>none</choice>", source.candidates), { selectedOccurrenceId: null });
    assert.throws(() => parsePhraseRelationJudgeOutput("candidate_9", source.candidates), /PHRASE_RELATION_JUDGE_OUTPUT_INVALID/u);
  });
});
