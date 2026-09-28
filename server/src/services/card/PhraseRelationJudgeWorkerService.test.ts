import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { phraseRelationJudgeHashInput, type PhraseRelationJudgeSource } from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CreateSystemEventLogInput, SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { PhraseRelationJudgeWorkerService } from "./PhraseRelationJudgeWorkerService.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";

const source: PhraseRelationJudgeSource = {
  userId: "user-1",
  anchor: { occurrenceId: "anchor", languageCode: "en", surfaceText: "cracking up", sentence: "I was cracking up.", startUtf16: 6, endUtf16: 17 },
  candidates: [
    { occurrenceId: "good", languageCode: "en", surfaceText: "burst out laughing", sentence: "I burst out laughing.", startUtf16: 2, endUtf16: 20, semanticScore: 0.91 },
    { occurrenceId: "bad", languageCode: "en", surfaceText: "cracked", sentence: "The screen cracked.", startUtf16: 11, endUtf16: 18, semanticScore: 0.88 },
  ],
};

function jobFor(value: PhraseRelationJudgeSource): CardEnrichmentJobEntity {
  return {
    id: "job-1", userId: value.userId, sourceKind: "phrase_occurrence", sourceId: value.anchor.occurrenceId,
    jobType: "judge_phrase_relation", attempts: 1, priority: 0,
    inputHash: createHash("sha256").update(phraseRelationJudgeHashInput(value)).digest("hex"),
    inputVersion: "phrase_relation_judge_v3:hash", workerId: "worker-1", payload: {},
  };
}

test("judges all recalled candidates once and persists the selected occurrence", async () => {
  const job = jobFor(source);
  const completions: unknown[] = [];
  let generationCalls = 0;
  const repository = {
    claimNextPhraseRelationJudgeJob: async () => job,
    loadPhraseRelationJudgeSource: async () => source,
    completePhraseRelationJudgeJob: async (_job: unknown, result: unknown) => { completions.push(result); return true; },
  } as unknown as CardEnrichmentRepository;
  const ai = {
    providerName: "test", modelName: "judge-model",
    async generateChatTextStream(_input: unknown, onEvent: (event: { type: "delta"; text: string }) => void) {
      generationCalls += 1;
      onEvent({ type: "delta", text: "<choice>candidate_1</choice>" });
    },
  } as unknown as AIProvider;

  assert.equal(await new PhraseRelationJudgeWorkerService(repository, ai).claimAndProcess("worker-1"), true);
  assert.equal(generationCalls, 1);
  assert.deepEqual(completions, [{ selectedOccurrenceId: "good", promptVersion: "phrase_relation_judge_v3", provider: "test", model: "judge-model" }]);
});

test("persists none without calling AI when retrieval found no candidates", async () => {
  const empty = { ...source, candidates: [] };
  const job = jobFor(empty);
  let generationCalls = 0;
  let selected: string | null | undefined;
  const repository = {
    claimNextPhraseRelationJudgeJob: async () => job,
    loadPhraseRelationJudgeSource: async () => empty,
    completePhraseRelationJudgeJob: async (_job: unknown, result: { selectedOccurrenceId: string | null }) => { selected = result.selectedOccurrenceId; return true; },
  } as unknown as CardEnrichmentRepository;
  const ai = {
    providerName: "test", modelName: "judge-model",
    async generateChatTextStream() { generationCalls += 1; },
  } as unknown as AIProvider;

  await new PhraseRelationJudgeWorkerService(repository, ai).claimAndProcess("worker-1");
  assert.equal(generationCalls, 0);
  assert.equal(selected, null);
});

test("meters historical judge jobs through the dedicated backfill budget", async () => {
  const job = { ...jobFor(source), priority: -100 };
  const resources: string[] = [];
  const repository = {
    claimNextPhraseRelationJudgeJob: async () => job,
    loadPhraseRelationJudgeSource: async () => source,
    completePhraseRelationJudgeJob: async () => true,
  } as unknown as CardEnrichmentRepository;
  const ai = {
    providerName: "test", modelName: "judge-model",
    async generateChatTextStream(_input: unknown, onEvent: (event: { type: "delta"; text: string }) => void) {
      onEvent({ type: "delta", text: "<choice>none</choice>" });
    },
  } as unknown as AIProvider;
  const governor = {
    async consumeRequest(resource: string) { resources.push(resource); },
    async execute(resource: string, _userId: string, task: () => Promise<unknown>) { resources.push(resource); return task(); },
  } as unknown as ResourceGovernor;

  await new PhraseRelationJudgeWorkerService(repository, ai, undefined, {}, governor).claimAndProcess("worker-1");
  assert.deepEqual(resources, ["llm_backfill", "llm"]);
});

test("records safe upstream metadata when relation judge retries", async () => {
  const job = jobFor(source);
  let retryAt: Date | null | undefined;
  let event: CreateSystemEventLogInput | null = null;
  const repository = {
    claimNextPhraseRelationJudgeJob: async () => job,
    loadPhraseRelationJudgeSource: async () => source,
    rescheduleOrFail: async (_job: unknown, _message: string, nextAttempt: Date | null) => { retryAt = nextAttempt; return true; },
  } as unknown as CardEnrichmentRepository;
  const upstreamError = Object.assign(new Error("UPSTREAM_AI_ERROR"), {
    code: "UPSTREAM_AI_ERROR",
    status: 429,
    upstreamCode: "RateLimitReached",
    failureKind: "http",
  });
  const ai = {
    providerName: "test", modelName: "judge-model",
    async generateChatTextStream() { throw upstreamError; },
  } as unknown as AIProvider;
  const logs = {
    async create(input: CreateSystemEventLogInput) { event = input; return {} as never; },
  } as SystemEventLogRepository;

  await new PhraseRelationJudgeWorkerService(repository, ai, logs).claimAndProcess("worker-1");

  assert.ok(retryAt instanceof Date);
  assert.equal(event?.event, "phrase.relation_judge.retry");
  assert.equal(event?.status, "ignored");
  assert.equal(event?.metadata?.upstreamStatus, 429);
  assert.equal(event?.metadata?.upstreamCode, "RateLimitReached");
  assert.equal(event?.metadata?.failureKind, "http");
  assert.equal(event?.metadata?.retryableUpstream, true);
});

test("records safe upstream metadata when relation judge reaches terminal failure", async () => {
  const job = { ...jobFor(source), attempts: 4 };
  let retryAt: Date | null | undefined;
  let event: CreateSystemEventLogInput | null = null;
  const repository = {
    claimNextPhraseRelationJudgeJob: async () => job,
    loadPhraseRelationJudgeSource: async () => source,
    rescheduleOrFail: async (_job: unknown, _message: string, nextAttempt: Date | null) => { retryAt = nextAttempt; return true; },
  } as unknown as CardEnrichmentRepository;
  const upstreamError = Object.assign(new Error("UPSTREAM_AI_ERROR"), {
    code: "UPSTREAM_AI_ERROR",
    upstreamCode: "AI_PROVIDER_TIMEOUT",
    failureKind: "timeout",
  });
  const ai = {
    providerName: "test", modelName: "judge-model",
    async generateChatTextStream() { throw upstreamError; },
  } as unknown as AIProvider;
  const logs = {
    async create(input: CreateSystemEventLogInput) { event = input; return {} as never; },
  } as SystemEventLogRepository;

  await new PhraseRelationJudgeWorkerService(repository, ai, logs).claimAndProcess("worker-1");

  assert.equal(retryAt, null);
  assert.equal(event?.event, "phrase.relation_judge.failed");
  assert.equal(event?.status, "failed");
  assert.equal(event?.metadata?.upstreamCode, "AI_PROVIDER_TIMEOUT");
  assert.equal(event?.metadata?.failureKind, "timeout");
  assert.equal(event?.metadata?.retryableUpstream, true);
});
