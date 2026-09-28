import assert from "node:assert/strict";
import test from "node:test";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { PhraseRelationJudgeBackfillScanner } from "./PhraseRelationJudgeBackfillScanner.js";

test("keeps the semantic judge scan bounded and user scoped", async () => {
  const calls: unknown[] = [];
  const repository = {
    enqueueMissingPhraseRelationJudgeJobs: async (input: unknown) => { calls.push(input); return 0; },
  } as unknown as CardEnrichmentRepository;
  const scanner = new PhraseRelationJudgeBackfillScanner(repository, {
    modelVersion: "embedding-v1",
    representationVersion: "usage_meaning_v2",
    minPhraseSimilarity: 0.72,
    minRepresentationSimilarity: 0.45,
    representationWeight: 0.7,
  }, undefined, { userId: "user-target", batchSize: 5, maxOutstanding: 10 });

  await scanner.runOnce();

  assert.deepEqual(calls, [{
    modelVersion: "embedding-v1",
    representationVersion: "usage_meaning_v2",
    minPhraseSimilarity: 0.72,
    minRepresentationSimilarity: 0.45,
    representationWeight: 0.7,
    promptVersion: "phrase_relation_judge_v3",
    limit: 5,
    maxOutstanding: 10,
    userId: "user-target",
  }]);
});
