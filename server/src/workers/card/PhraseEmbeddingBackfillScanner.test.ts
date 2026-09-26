import assert from "node:assert/strict";
import test from "node:test";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { PhraseEmbeddingBackfillScanner } from "./PhraseEmbeddingBackfillScanner.js";

test("enqueues a bounded phrase embedding backfill batch for the active model", async () => {
  const calls: unknown[] = [];
  const events: unknown[] = [];
  const repository = {
    async enqueueMissingPhraseEmbeddingJobs(input: unknown) {
      calls.push(input);
      return 7;
    },
  } as CardEnrichmentRepository;
  const logs = {
    async create(input: unknown) {
      events.push(input);
    },
  } as SystemEventLogRepository;
  const scanner = new PhraseEmbeddingBackfillScanner(repository, "embedding-v2", logs, {
    batchSize: 12,
    maxOutstanding: 24,
  });

  await scanner.runOnce();

  assert.deepEqual(calls, [{ modelVersion: "embedding-v2", limit: 12, maxOutstanding: 24 }]);
  assert.deepEqual(events, [{
    module: "card",
    event: "phrase.embedding_backfill.enqueued",
    level: "info",
    status: "success",
    metadata: {
      enqueued: 7,
      modelVersion: "embedding-v2",
      batchSize: 12,
      maxOutstanding: 24,
    },
  }]);
});

test("records scanner failures without throwing out of the worker loop", async () => {
  const events: Array<Record<string, unknown>> = [];
  const repository = {
    async enqueueMissingPhraseEmbeddingJobs() {
      throw new Error("database temporarily unavailable");
    },
  } as CardEnrichmentRepository;
  const logs = {
    async create(input: Record<string, unknown>) {
      events.push(input);
    },
  } as SystemEventLogRepository;
  const scanner = new PhraseEmbeddingBackfillScanner(repository, "embedding-v2", logs);

  await scanner.runOnce();

  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "phrase.embedding_backfill.scan_failed");
  assert.equal(events[0]?.errorMessage, "database temporarily unavailable");
});
