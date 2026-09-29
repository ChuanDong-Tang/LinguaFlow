import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueuePhraseOccurrenceEmbeddingForOccurrence,
  loadPhraseOccurrenceEmbeddingSourceData,
} from "./PhraseOccurrenceEmbeddingJobs.js";

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

test("new occurrences enqueue V3 directly and never create a V2 occurrence job", async () => {
  const previousEnabled = process.env.RELATED_PHRASE_JUDGE_ENABLED;
  const previousUserId = process.env.RELATED_PHRASE_JUDGE_USER_ID;
  const previousDeployment = process.env.AZURE_EMBEDDING_DEPLOYMENT;
  process.env.RELATED_PHRASE_JUDGE_ENABLED = "true";
  process.env.RELATED_PHRASE_JUDGE_USER_ID = "user-1";
  process.env.AZURE_EMBEDDING_DEPLOYMENT = "embedding-deployment";
  let created: Record<string, unknown> | null = null;
  let rawCalls = 0;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    async $queryRaw() {
      rawCalls += 1;
      if (rawCalls === 1) return [{ ready: 1 }];
      if (rawCalls === 2) return [{
        occurrenceId: "occurrence-1", languageCode: "en-US", surfaceText: "cracking up",
        sentence: "So ridiculous, I was cracking up.", startUtf16: 21, endUtf16: 32,
      }];
      return [];
    },
    phraseOccurrenceRelationDecision: { async findUnique() { return null; } },
    cardEnrichmentJob: {
      async findUnique() { return null; },
      async create(input: { data: Record<string, unknown> }) { created = input.data; },
      async upsert() { assert.fail("V2 occurrence job must not be created"); },
    },
  };
  try {
    await enqueuePhraseOccurrenceEmbeddingForOccurrence(client, "occurrence-1");
  } finally {
    if (previousEnabled === undefined) delete process.env.RELATED_PHRASE_JUDGE_ENABLED;
    else process.env.RELATED_PHRASE_JUDGE_ENABLED = previousEnabled;
    if (previousUserId === undefined) delete process.env.RELATED_PHRASE_JUDGE_USER_ID;
    else process.env.RELATED_PHRASE_JUDGE_USER_ID = previousUserId;
    if (previousDeployment === undefined) delete process.env.AZURE_EMBEDDING_DEPLOYMENT;
    else process.env.AZURE_EMBEDDING_DEPLOYMENT = previousDeployment;
  }

  assert.equal(created?.jobType, "judge_phrase_relation");
  assert.equal(created?.priority, 0);
  assert.match(String(created?.inputVersion), /^phrase_relation_judge_v3:/u);
});

test("users outside the V3 canary do not create V2 fallback jobs", async () => {
  const previousEnabled = process.env.RELATED_PHRASE_JUDGE_ENABLED;
  const previousUserId = process.env.RELATED_PHRASE_JUDGE_USER_ID;
  process.env.RELATED_PHRASE_JUDGE_ENABLED = "true";
  process.env.RELATED_PHRASE_JUDGE_USER_ID = "another-user";
  let wrote = false;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    cardEnrichmentJob: {
      async upsert() { wrote = true; },
      async create() { wrote = true; },
    },
  };
  try {
    await enqueuePhraseOccurrenceEmbeddingForOccurrence(client, "occurrence-1");
  } finally {
    if (previousEnabled === undefined) delete process.env.RELATED_PHRASE_JUDGE_ENABLED;
    else process.env.RELATED_PHRASE_JUDGE_ENABLED = previousEnabled;
    if (previousUserId === undefined) delete process.env.RELATED_PHRASE_JUDGE_USER_ID;
    else process.env.RELATED_PHRASE_JUDGE_USER_ID = previousUserId;
  }
  assert.equal(wrote, false);
});
