import assert from "node:assert/strict";
import test from "node:test";
import { loadPhraseOccurrenceEmbeddingSourceData } from "./PhraseOccurrenceEmbeddingJobs.js";

function fakeClient(segments: Array<{ id: string; text: string; ordinal: number }>) {
  return {
    phraseOccurrence: {
      async findFirst() {
        return {
          id: "occurrence-1",
          userId: "user-1",
          cardId: "card-1",
          sourceField: "ai_expression",
          segmentId: "stale-segment",
          startUtf16: 21,
          endUtf16: 32,
          surfaceText: "cracking up",
          phrase: { languageCode: "en-US", canonicalText: "crack up", status: "normalized" },
        };
      },
    },
    cardRewriteSegment: { async findMany() { return segments; } },
  };
}

test("recovers a stale segment id from one exact current range match", async () => {
  const sentence = "So ridiculous, I was cracking up.";
  const source = await loadPhraseOccurrenceEmbeddingSourceData(fakeClient([
    { id: "current-segment", text: sentence, ordinal: 0 },
  ]), "occurrence-1", "user-1");

  assert.equal(source?.sentence, sentence);
  assert.equal(source?.startUtf16, 21);
  assert.equal(source?.endUtf16, 32);
});

test("fails closed when a stale occurrence matches multiple current segments", async () => {
  const sentence = "So ridiculous, I was cracking up.";
  const source = await loadPhraseOccurrenceEmbeddingSourceData(fakeClient([
    { id: "segment-1", text: sentence, ordinal: 0 },
    { id: "segment-2", text: sentence, ordinal: 1 },
  ]), "occurrence-1", "user-1");

  assert.equal(source, null);
});
