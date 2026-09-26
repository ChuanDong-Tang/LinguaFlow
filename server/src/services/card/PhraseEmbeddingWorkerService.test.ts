import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { PhraseEmbeddingWorkerService } from "./PhraseEmbeddingWorkerService.js";

function phraseJob(inputHash: string): CardEnrichmentJobEntity {
  return {
    id: "job-1",
    userId: "user-1",
    sourceKind: "phrase",
    sourceId: "phrase-1",
    jobType: "generate_phrase_embedding",
    attempts: 1,
    priority: 0,
    inputHash,
    inputVersion: `phrase_embedding_input_v1:${inputHash}`,
    workerId: "worker-1",
    payload: null,
  };
}

const embeddingProvider: EmbeddingProvider = {
  providerName: "fake",
  modelName: "fake-model",
  modelVersion: "fake-model:v1:1536",
  dimensions: 1536,
  async embed(input) {
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

test("embeds the normalized phrase only while its queued input is current", async () => {
  const input = "en-US\nfit in";
  const job = phraseJob(createHash("sha256").update(input).digest("hex"));
  let completed = false;
  const repository = {
    async claimNextPhraseEmbeddingJob() { return job; },
    async loadPhraseEmbeddingSource() {
      return { userId: job.userId, phraseId: job.sourceId, languageCode: "en-US", canonicalText: "fit in" };
    },
    async completePhraseEmbeddingJob(_job, result) {
      completed = result.modelVersion === embeddingProvider.modelVersion;
      return true;
    },
  } as CardEnrichmentRepository;

  const handled = await new PhraseEmbeddingWorkerService(repository, embeddingProvider).claimAndProcess("worker-1");

  assert.equal(handled, true);
  assert.equal(completed, true);
});

test("discards a stale phrase embedding job without calling the provider", async () => {
  const job = phraseJob("stale-hash");
  let embedded = false;
  let completionReason = "";
  const provider: EmbeddingProvider = {
    ...embeddingProvider,
    async embed() {
      embedded = true;
      return embeddingProvider.embed("unused");
    },
  };
  const repository = {
    async claimNextPhraseEmbeddingJob() { return job; },
    async loadPhraseEmbeddingSource() {
      return { userId: job.userId, phraseId: job.sourceId, languageCode: "en-US", canonicalText: "match" };
    },
    async completeWithoutResult(_job, reason) { completionReason = reason; return true; },
  } as CardEnrichmentRepository;

  await new PhraseEmbeddingWorkerService(repository, provider).claimAndProcess("worker-1");

  assert.equal(embedded, false);
  assert.equal(completionReason, "PHRASE_EMBEDDING_INPUT_STALE");
});
