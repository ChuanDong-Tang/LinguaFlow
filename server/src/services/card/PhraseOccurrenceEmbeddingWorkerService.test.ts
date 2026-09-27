import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { buildPhraseOccurrenceEmbeddingInput } from "@lf/core/text/phraseOccurrenceEmbedding.js";
import { PhraseOccurrenceEmbeddingWorkerService } from "./PhraseOccurrenceEmbeddingWorkerService.js";

const source = {
  userId: "user-1",
  occurrenceId: "occurrence-1",
  cardId: "card-1",
  languageCode: "en-US",
  canonicalText: "crack up",
  sentence: "I was cracking up.",
  startUtf16: 6,
  endUtf16: 17,
};

function occurrenceJob(inputHash: string): CardEnrichmentJobEntity {
  return {
    id: "job-1",
    userId: source.userId,
    sourceKind: "phrase_occurrence",
    sourceId: source.occurrenceId,
    jobType: "generate_phrase_occurrence_embedding",
    attempts: 1,
    priority: 0,
    inputHash,
    inputVersion: `phrase_occurrence_embedding_input_v1:${inputHash}`,
    workerId: "worker-1",
    payload: null,
  };
}

const provider: EmbeddingProvider = {
  providerName: "fake",
  modelName: "fake-model",
  modelVersion: "fake-model:v1:1536",
  dimensions: 1536,
  async embed() {
    return {
      embedding: Array.from({ length: 1536 }, () => 0),
      provider: "fake",
      model: "fake-model",
      modelVersion: "fake-model:v1:1536",
      dimensions: 1536,
      requestId: null,
      promptTokens: null,
    };
  },
};

test("embeds phrase occurrence with its marked sentence context", async () => {
  const input = buildPhraseOccurrenceEmbeddingInput(source)!;
  const job = occurrenceJob(createHash("sha256").update(input).digest("hex"));
  let completed = false;
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async completePhraseOccurrenceEmbeddingJob() { completed = true; return true; },
  } as CardEnrichmentRepository;

  await new PhraseOccurrenceEmbeddingWorkerService(repository, provider).claimAndProcess("worker-1");

  assert.equal(completed, true);
});

test("discards stale contextual embedding input", async () => {
  const job = occurrenceJob("stale");
  let embedded = false;
  let reason = "";
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async completeWithoutResult(_job: unknown, value: string) { reason = value; return true; },
  } as CardEnrichmentRepository;
  const staleProvider = { ...provider, async embed() { embedded = true; return provider.embed("unused"); } };

  await new PhraseOccurrenceEmbeddingWorkerService(repository, staleProvider).claimAndProcess("worker-1");

  assert.equal(embedded, false);
  assert.equal(reason, "PHRASE_OCCURRENCE_EMBEDDING_INPUT_STALE");
});
