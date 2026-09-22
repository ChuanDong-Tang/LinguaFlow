import assert from "node:assert/strict";
import test from "node:test";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { CardRewriteAlignmentWorkerService } from "./CardRewriteAlignmentWorkerService.js";

test("repairs a non-contiguous model mapping once without expanding the original span", async () => {
  const job: CardEnrichmentJobEntity = {
    id: "job-1", userId: "user-1", sourceKind: "card", sourceId: "card-1",
    jobType: "align_rewrite_original", attempts: 1, priority: 0,
    inputHash: "hash", inputVersion: "card_rewrite_alignment_v9", workerId: "worker-1", payload: null,
  };
  const generated = [
    JSON.stringify({ matches: [{ target: 0, source: [0, 2] }, { target: 1, source: [1] }] }),
    JSON.stringify({ matches: [{ target: 0, source: [0, 1] }, { target: 1, source: [2] }] }),
  ];
  let calls = 0;
  let completed: unknown;
  let failure: string | null = null;
  const provider = {
    providerName: "fake", modelName: "fake", supportsImageInput: false,
    async generateChatTextStream(_input, onEvent) {
      const output = generated[calls++];
      assert.ok(output);
      await onEvent({ type: "delta", text: output });
    },
  } satisfies AIProvider;
  const repository = {
    async claimNextRewriteAlignmentJob() { return job; },
    async loadRewriteAlignmentSource() {
      return {
        userId: job.userId, sourceId: job.sourceId, originalText: "A, B, C.",
        rewrittenText: "One. Two.", languageCode: "en-US", rewrittenLanguageCode: "en-US",
        appLocaleSnapshot: "en-US", originalContentHash: "original-hash", rewrittenSourceHash: "rewrite-hash",
      };
    },
    async completeRewriteAlignmentJob(_job, alignment) { completed = alignment; return true; },
    async rescheduleOrFail(_job, errorMessage) { failure = errorMessage; return true; },
  } as CardEnrichmentRepository;

  await new CardRewriteAlignmentWorkerService(repository, provider).claimAndProcess("worker-1");
  assert.equal(calls, 2);
  assert.equal(failure, null);
  assert.deepEqual((completed as { groups: unknown }).groups, [
    { sourceOrdinals: [0, 1], targetOrdinals: [0] },
    { sourceOrdinals: [2], targetOrdinals: [1] },
  ]);
});

test("does not persist an invalid mapping when the bounded repair also fails", async () => {
  const job: CardEnrichmentJobEntity = {
    id: "job-2", userId: "user-1", sourceKind: "card", sourceId: "card-2",
    jobType: "align_rewrite_original", attempts: 3, priority: 0,
    inputHash: "hash", inputVersion: "card_rewrite_alignment_v9", workerId: "worker-1", payload: null,
  };
  let calls = 0;
  let saved = false;
  let failure: string | null = null;
  const provider = {
    providerName: "fake", modelName: "fake",
    async generateChatTextStream(_input, onEvent) {
      calls++;
      await onEvent({ type: "delta", text: JSON.stringify({ matches: [
        { target: 0, source: [0, 2] }, { target: 1, source: [1] },
      ] }) });
    },
  } satisfies AIProvider;
  const repository = {
    async claimNextRewriteAlignmentJob() { return job; },
    async loadRewriteAlignmentSource() {
      return {
        userId: job.userId, sourceId: job.sourceId, originalText: "A, B, C.",
        rewrittenText: "One. Two.", languageCode: "en-US", rewrittenLanguageCode: "en-US",
        appLocaleSnapshot: "en-US", originalContentHash: "original-hash", rewrittenSourceHash: "rewrite-hash",
      };
    },
    async completeRewriteAlignmentJob() { saved = true; return true; },
    async rescheduleOrFail(_job, errorMessage) { failure = errorMessage; return true; },
  } as CardEnrichmentRepository;

  await new CardRewriteAlignmentWorkerService(repository, provider).claimAndProcess("worker-1");
  assert.equal(calls, 2);
  assert.equal(saved, false);
  assert.match(failure ?? "", /CARD_REWRITE_ALIGNMENT_NON_CONTIGUOUS_SOURCE/u);
});

test("uses the only exact original span for up to three rewrite sentences without inventing source indexes", async () => {
  const job: CardEnrichmentJobEntity = {
    id: "job-3", userId: "user-1", sourceKind: "card", sourceId: "card-3",
    jobType: "align_rewrite_original", attempts: 1, priority: 0,
    inputHash: "hash", inputVersion: "card_rewrite_alignment_v9", workerId: "worker-1", payload: null,
  };
  let completed: unknown;
  const repository = {
    async claimNextRewriteAlignmentJob() { return job; },
    async loadRewriteAlignmentSource() {
      return {
        userId: job.userId, sourceId: job.sourceId,
        originalText: "今天感觉事情好多 而且我居然胖了10斤 啊啊啊啊 我感觉很烦 而且 我要成为大美女",
        rewrittenText: "I have a lot going on. I gained weight. I want to be beautiful.",
        languageCode: "en-US", rewrittenLanguageCode: "en-US", appLocaleSnapshot: "zh-CN",
        originalContentHash: "original-hash", rewrittenSourceHash: "rewrite-hash",
      };
    },
    async completeRewriteAlignmentJob(_job, alignment) { completed = alignment; return true; },
  } as CardEnrichmentRepository;
  const provider = {
    providerName: "fake", modelName: "fake",
    async generateChatTextStream() { assert.fail("single source should not call the model"); },
  } satisfies AIProvider;
  await new CardRewriteAlignmentWorkerService(repository, provider).claimAndProcess("worker-1");
  assert.deepEqual((completed as { groups: unknown }).groups, [
    { sourceOrdinals: [0], targetOrdinals: [0, 1, 2] },
  ]);
});
