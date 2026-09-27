import assert from "node:assert/strict";
import test from "node:test";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { PhraseOccurrenceEmbeddingBackfillScanner } from "./PhraseOccurrenceEmbeddingBackfillScanner.js";

test("enqueues a slow target-user contextual embedding batch", async () => {
  const calls: unknown[] = [];
  const repository = {
    async enqueueMissingPhraseOccurrenceEmbeddingJobs(input: unknown) { calls.push(input); return 3; },
  } as CardEnrichmentRepository;
  const scanner = new PhraseOccurrenceEmbeddingBackfillScanner(repository, "embedding-v2", "usage_meaning_v1", "phrase_occurrence_sense_v1", undefined, {
    batchSize: 5,
    maxOutstanding: 10,
    userId: "user-1",
  });

  await scanner.runOnce();

  assert.deepEqual(calls, [{
    modelVersion: "embedding-v2",
    representationVersion: "usage_meaning_v1",
    promptVersion: "phrase_occurrence_sense_v1",
    limit: 5,
    maxOutstanding: 10,
    userId: "user-1",
  }]);
});
