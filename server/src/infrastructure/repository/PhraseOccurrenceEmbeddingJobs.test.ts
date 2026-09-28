import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueuePhraseOccurrenceEmbeddingForOccurrence,
  loadPhraseOccurrenceEmbeddingSourceData,
} from "./PhraseOccurrenceEmbeddingJobs.js";
import {
  PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION,
  PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION,
} from "@lf/core/Prompts/phraseOccurrenceSensePrompt.js";

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

test("new occurrences enqueue the configured sense representation", async () => {
  const previous = process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION;
  const previousEnabled = process.env.RELATED_PHRASE_CONTEXT_ENABLED;
  process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = "usage_meaning_v1";
  process.env.RELATED_PHRASE_CONTEXT_ENABLED = "true";
  let upsert: Record<string, unknown> | null = null;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    cardEnrichmentJob: {
      async upsert(input: Record<string, unknown>) { upsert = input; },
    },
  };
  try {
    await enqueuePhraseOccurrenceEmbeddingForOccurrence(client, "occurrence-1");
  } finally {
    if (previous === undefined) delete process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION;
    else process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = previous;
    if (previousEnabled === undefined) delete process.env.RELATED_PHRASE_CONTEXT_ENABLED;
    else process.env.RELATED_PHRASE_CONTEXT_ENABLED = previousEnabled;
  }

  const create = (upsert as { create?: { inputVersion?: string; payload?: Record<string, unknown> } } | null)?.create;
  assert.match(create?.inputVersion ?? "", /^phrase_occurrence_embedding_input_v2:usage_meaning_v1:/u);
  assert.equal(create?.payload?.representationVersion, "usage_meaning_v1");
  assert.equal(create?.payload?.promptVersion, "phrase_occurrence_sense_v1");
});

test("an active sense backfill takes precedence over a legacy relation representation", async () => {
  const previous = {
    relationEnabled: process.env.RELATED_PHRASE_CONTEXT_ENABLED,
    relationRepresentation: process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION,
    backfillEnabled: process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED,
    backfillRepresentation: process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION,
  };
  process.env.RELATED_PHRASE_CONTEXT_ENABLED = "true";
  process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = "marked_sentence_v1";
  process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED = "true";
  process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION = "usage_meaning_v1";
  let upsert: Record<string, unknown> | null = null;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    cardEnrichmentJob: {
      async upsert(input: Record<string, unknown>) { upsert = input; },
    },
  };
  try {
    await enqueuePhraseOccurrenceEmbeddingForOccurrence(client, "occurrence-1");
  } finally {
    for (const [key, value] of Object.entries({
      RELATED_PHRASE_CONTEXT_ENABLED: previous.relationEnabled,
      RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION: previous.relationRepresentation,
      CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED: previous.backfillEnabled,
      CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION: previous.backfillRepresentation,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const create = (upsert as { create?: { payload?: Record<string, unknown> } } | null)?.create;
  assert.equal(create?.payload?.representationVersion, "usage_meaning_v1");
});

test("new occurrences enqueue the configured V2 context meaning representation", async () => {
  const previous = process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION;
  const previousEnabled = process.env.RELATED_PHRASE_CONTEXT_ENABLED;
  process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION;
  process.env.RELATED_PHRASE_CONTEXT_ENABLED = "true";
  let upsert: Record<string, unknown> | null = null;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    cardEnrichmentJob: {
      async upsert(input: Record<string, unknown>) { upsert = input; },
    },
  };
  try {
    await enqueuePhraseOccurrenceEmbeddingForOccurrence(client, "occurrence-1");
  } finally {
    if (previous === undefined) delete process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION;
    else process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = previous;
    if (previousEnabled === undefined) delete process.env.RELATED_PHRASE_CONTEXT_ENABLED;
    else process.env.RELATED_PHRASE_CONTEXT_ENABLED = previousEnabled;
  }

  const create = (upsert as { create?: { inputVersion?: string; payload?: Record<string, unknown> } } | null)?.create;
  assert.match(create?.inputVersion ?? "", /^phrase_occurrence_embedding_input_v2:usage_meaning_v2:/u);
  assert.equal(create?.payload?.representationVersion, PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION);
  assert.equal(create?.payload?.promptVersion, PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION);
});

test("re-adding the same cloze refreshes its existing V2 embedding job", async () => {
  const previous = process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION;
  const previousEnabled = process.env.RELATED_PHRASE_CONTEXT_ENABLED;
  process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION;
  process.env.RELATED_PHRASE_CONTEXT_ENABLED = "true";
  let upsert: Record<string, unknown> | null = null;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    cardEnrichmentJob: {
      async upsert(input: Record<string, unknown>) { upsert = input; },
    },
  };
  try {
    await enqueuePhraseOccurrenceEmbeddingForOccurrence(client, "occurrence-1", { refreshExisting: true });
  } finally {
    if (previous === undefined) delete process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION;
    else process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION = previous;
    if (previousEnabled === undefined) delete process.env.RELATED_PHRASE_CONTEXT_ENABLED;
    else process.env.RELATED_PHRASE_CONTEXT_ENABLED = previousEnabled;
  }

  const update = (upsert as { update?: Record<string, unknown> } | null)?.update;
  assert.equal(update?.status, "queued");
  assert.equal(update?.attempts, 0);
  assert.equal(update?.completedAt, null);
});

test("judge V3 bypasses occurrence-level AI representation jobs for its rollout scope", async () => {
  const previousEnabled = process.env.RELATED_PHRASE_JUDGE_ENABLED;
  const previousUserId = process.env.RELATED_PHRASE_JUDGE_USER_ID;
  process.env.RELATED_PHRASE_JUDGE_ENABLED = "true";
  process.env.RELATED_PHRASE_JUDGE_USER_ID = "user-1";
  let upserted = false;
  const client = {
    ...fakeClient([{ id: "current-segment", text: "So ridiculous, I was cracking up.", ordinal: 0 }]),
    cardEnrichmentJob: {
      async upsert() { upserted = true; },
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

  assert.equal(upserted, false);
});
