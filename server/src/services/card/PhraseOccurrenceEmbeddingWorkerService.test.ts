import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { EmbeddingProvider } from "@lf/core/ports/ai/EmbeddingProvider.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { CreateSystemEventLogInput, SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { buildPhraseOccurrenceEmbeddingInput } from "@lf/core/text/phraseOccurrenceEmbedding.js";
import {
  phraseOccurrenceContextMeaningPromptHashInput,
  phraseOccurrenceSensePromptHashInput,
  PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION,
  PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION,
  PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION,
  PHRASE_OCCURRENCE_SENSE_REPRESENTATION_VERSION,
} from "@lf/core/Prompts/phraseOccurrenceSensePrompt.js";
import { PhraseOccurrenceEmbeddingWorkerService } from "./PhraseOccurrenceEmbeddingWorkerService.js";
import type { ResourceGovernor } from "../resource/ResourceGovernor.js";

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

function occurrenceJob(inputHash: string, sense = false): CardEnrichmentJobEntity {
  return {
    id: "job-1",
    userId: source.userId,
    sourceKind: "phrase_occurrence",
    sourceId: source.occurrenceId,
    jobType: "generate_phrase_occurrence_embedding",
    attempts: 1,
    priority: 0,
    inputHash,
    inputVersion: sense
      ? `phrase_occurrence_embedding_backfill_v2:${PHRASE_OCCURRENCE_SENSE_REPRESENTATION_VERSION}:${PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION}:fake-model:v1:1536:${inputHash}`
      : `phrase_occurrence_embedding_input_v1:${inputHash}`,
    workerId: "worker-1",
    payload: sense ? { representationVersion: PHRASE_OCCURRENCE_SENSE_REPRESENTATION_VERSION } : null,
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

const aiProvider: AIProvider = {
  providerName: "fake-ai",
  modelName: "fake-ai-model",
  async generateChatTextStream(_input, onEvent) {
    await onEvent({ type: "delta", text: "<meaning>laugh uncontrollably</meaning>" });
    await onEvent({ type: "done" });
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
  } as unknown as CardEnrichmentRepository;

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
  } as unknown as CardEnrichmentRepository;
  const staleProvider = { ...provider, async embed() { embedded = true; return provider.embed("unused"); } };

  await new PhraseOccurrenceEmbeddingWorkerService(repository, staleProvider).claimAndProcess("worker-1");

  assert.equal(embedded, false);
  assert.equal(reason, "PHRASE_OCCURRENCE_EMBEDDING_INPUT_STALE");
});

test("generates a concise usage meaning before embedding a sense representation", async () => {
  const inputHash = createHash("sha256").update(phraseOccurrenceSensePromptHashInput(source)).digest("hex");
  const job = occurrenceJob(inputHash, true);
  let embeddedInput = "";
  let completedRepresentation: unknown;
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async completePhraseOccurrenceEmbeddingJob(_job: unknown, _result: unknown, representation: unknown) {
      completedRepresentation = representation;
      return true;
    },
  } as unknown as CardEnrichmentRepository;
  const senseEmbeddingProvider = {
    ...provider,
    async embed(input: string) {
      embeddedInput = input;
      return provider.embed(input);
    },
  };
  const consumedResources: string[] = [];
  const governor = {
    async consumeRequest(resource: string) { consumedResources.push(resource); },
    async execute(resource: string, _userId: string, task: () => Promise<unknown>) { consumedResources.push(resource); return task(); },
    async executeConcurrency(_resource: string, _userId: string, task: () => Promise<unknown>) { return task(); },
  } as unknown as ResourceGovernor;

  await new PhraseOccurrenceEmbeddingWorkerService(
    repository,
    senseEmbeddingProvider,
    undefined,
    {},
    governor,
    aiProvider,
  ).claimAndProcess("worker-1");

  assert.equal(embeddedInput, "usage meaning: laugh uncontrollably");
  assert.deepEqual(consumedResources, ["llm"]);
  assert.deepEqual(completedRepresentation, {
    representationVersion: PHRASE_OCCURRENCE_SENSE_REPRESENTATION_VERSION,
    promptVersion: PHRASE_OCCURRENCE_SENSE_PROMPT_VERSION,
    meaningText: "laugh uncontrollably",
    polarity: null,
    modality: null,
    meaningKind: null,
  });
});

test("generates and persists one structured V2 context meaning", async () => {
  const contextualSource = {
    ...source,
    canonicalText: "really want",
    sentence: "They don't really want to make big changes.",
    startUtf16: 11,
    endUtf16: 22,
  };
  const inputHash = createHash("sha256")
    .update(phraseOccurrenceContextMeaningPromptHashInput(contextualSource))
    .digest("hex");
  const job = {
    ...occurrenceJob(inputHash),
    inputVersion: `phrase_occurrence_embedding_backfill_v2:${PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION}:${PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION}:fake-model:v1:1536:${inputHash}`,
    payload: { representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION },
  };
  let embeddedInput = "";
  let maxOutputTokens: number | undefined;
  let completedRepresentation: unknown;
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return contextualSource; },
    async completePhraseOccurrenceEmbeddingJob(_job: unknown, _result: unknown, representation: unknown) {
      completedRepresentation = representation;
      return true;
    },
  } as unknown as CardEnrichmentRepository;
  const contextAiProvider: AIProvider = {
    ...aiProvider,
    async generateChatTextStream(input, onEvent) {
      maxOutputTokens = input.maxOutputTokens;
      await onEvent({ type: "delta", text: [
        "<meaning>lack desire to make changes</meaning>",
        "<polarity>negated</polarity>",
        "<modality>plain</modality>",
        "<meaning_kind>process</meaning_kind>",
      ].join("\n") });
      await onEvent({ type: "done" });
    },
  };
  const contextEmbeddingProvider = {
    ...provider,
    async embed(input: string) {
      embeddedInput = input;
      return provider.embed(input);
    },
  };

  await new PhraseOccurrenceEmbeddingWorkerService(
    repository,
    contextEmbeddingProvider,
    undefined,
    {},
    undefined,
    contextAiProvider,
  ).claimAndProcess("worker-1");

  assert.equal(embeddedInput, [
    "contextual usage meaning: lack desire to make changes",
    "polarity: negated",
    "external modality: plain",
    "meaning kind: process",
  ].join("\n"));
  assert.equal(maxOutputTokens, 160);
  assert.deepEqual(completedRepresentation, {
    representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION,
    promptVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION,
    meaningText: "lack desire to make changes",
    polarity: "negated",
    modality: "plain",
    meaningKind: "process",
  });
});

test("atomically requests V2 relation judging for the configured user after its current embedding", async () => {
  const inputHash = createHash("sha256")
    .update(phraseOccurrenceContextMeaningPromptHashInput(source))
    .digest("hex");
  const job = {
    ...occurrenceJob(inputHash),
    inputVersion: `phrase_occurrence_embedding_input_v2:${PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION}:${inputHash}`,
    payload: { representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION },
  };
  let relationJudge: unknown;
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async completePhraseOccurrenceEmbeddingJob(_job: unknown, _result: unknown, _representation: unknown, value: unknown) {
      relationJudge = value;
      return true;
    },
  } as unknown as CardEnrichmentRepository;
  const contextAiProvider: AIProvider = {
    ...aiProvider,
    async generateChatTextStream(_input, onEvent) {
      await onEvent({ type: "delta", text: [
        "<meaning>laugh uncontrollably</meaning>",
        "<polarity>neutral</polarity>",
        "<modality>plain</modality>",
        "<meaning_kind>reaction</meaning_kind>",
      ].join("\n") });
      await onEvent({ type: "done" });
    },
  };

  await new PhraseOccurrenceEmbeddingWorkerService(
    repository,
    provider,
    undefined,
    {},
    undefined,
    contextAiProvider,
    {
      enabled: true,
      userId: source.userId,
      promptVersion: "phrase_relation_judge_v2",
      modelVersion: provider.modelVersion,
      representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION,
      minPhraseSimilarity: 0.72,
      minRepresentationSimilarity: 0.45,
      representationWeight: 0.7,
    },
  ).claimAndProcess("worker-1");

  assert.deepEqual(relationJudge, {
    promptVersion: "phrase_relation_judge_v2",
    modelVersion: provider.modelVersion,
    representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION,
    minPhraseSimilarity: 0.72,
    minRepresentationSimilarity: 0.45,
    representationWeight: 0.7,
    priority: 0,
  });
});

test("does not consume the historical budget for realtime V2 generation", async () => {
  const inputHash = createHash("sha256").update(phraseOccurrenceContextMeaningPromptHashInput(source)).digest("hex");
  const job = {
    ...occurrenceJob(inputHash),
    inputVersion: `phrase_occurrence_embedding_input_v2:${PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION}:${inputHash}`,
    payload: { representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION },
  };
  const resources: string[] = [];
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async completePhraseOccurrenceEmbeddingJob() { return true; },
  } as unknown as CardEnrichmentRepository;
  const governor = {
    async consumeRequest(resource: string) { resources.push(resource); },
    async execute(resource: string, _userId: string, task: () => Promise<unknown>) { resources.push(resource); return task(); },
    async executeConcurrency(_resource: string, _userId: string, task: () => Promise<unknown>) { return task(); },
  } as unknown as ResourceGovernor;
  const contextAiProvider: AIProvider = {
    ...aiProvider,
    async generateChatTextStream(_input, onEvent) {
      await onEvent({ type: "delta", text: "<meaning>laugh uncontrollably</meaning>\n<polarity>neutral</polarity>\n<modality>plain</modality>\n<meaning_kind>reaction</meaning_kind>" });
    },
  };

  await new PhraseOccurrenceEmbeddingWorkerService(repository, provider, undefined, {}, governor, contextAiProvider).claimAndProcess("worker-1");
  assert.deepEqual(resources, ["llm"]);
});

test("records safe upstream metadata for retryable occurrence embedding failures", async () => {
  const inputHash = createHash("sha256")
    .update(phraseOccurrenceContextMeaningPromptHashInput(source))
    .digest("hex");
  const job = {
    ...occurrenceJob(inputHash),
    inputVersion: `phrase_occurrence_embedding_input_v2:${PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION}:${inputHash}`,
    payload: { representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION },
  };
  let retryAt: Date | null = null;
  let event: CreateSystemEventLogInput | null = null;
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async rescheduleOrFail(_job: unknown, _message: string, value: Date | null) { retryAt = value; return true; },
  } as unknown as CardEnrichmentRepository;
  const logs = {
    async create(input: CreateSystemEventLogInput) { event = input; return {} as never; },
  } as SystemEventLogRepository;
  const upstreamError = Object.assign(new Error("UPSTREAM_AI_ERROR"), {
    code: "UPSTREAM_AI_ERROR",
    status: 429,
    upstreamCode: "RateLimitReached",
    failureKind: "http",
  });
  const failingProvider: AIProvider = {
    ...aiProvider,
    async generateChatTextStream() { throw upstreamError; },
  };

  await new PhraseOccurrenceEmbeddingWorkerService(
    repository,
    provider,
    logs,
    {},
    undefined,
    failingProvider,
  ).claimAndProcess("worker-1");

  assert.ok(retryAt);
  assert.ok(event);
  assert.equal(event.event, "phrase.occurrence_embedding.retry");
  assert.equal(event.level, "warn");
  assert.equal(event.status, "ignored");
  const metadata = event.metadata as Record<string, unknown>;
  assert.equal(typeof metadata.durationMs, "number");
  const { durationMs: _durationMs, ...stableMetadata } = metadata;
  assert.deepEqual(stableMetadata, {
    occurrenceId: source.occurrenceId,
    modelVersion: provider.modelVersion,
    attempts: 1,
    nextAttemptAt: retryAt.toISOString(),
    errorCode: "UPSTREAM_AI_ERROR",
    upstreamStatus: 429,
    upstreamCode: "RateLimitReached",
    failureKind: "http",
    errorName: "Error",
    retryableUpstream: true,
  });
});

test("records safe upstream metadata when occurrence embedding retries are exhausted", async () => {
  const inputHash = createHash("sha256")
    .update(phraseOccurrenceContextMeaningPromptHashInput(source))
    .digest("hex");
  const job = {
    ...occurrenceJob(inputHash),
    attempts: 4,
    inputVersion: `phrase_occurrence_embedding_input_v2:${PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION}:${inputHash}`,
    payload: { representationVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_REPRESENTATION_VERSION },
  };
  let persistedRetryAt: Date | null | undefined;
  let event: CreateSystemEventLogInput | null = null;
  const repository = {
    async claimNextPhraseOccurrenceEmbeddingJob() { return job; },
    async loadPhraseOccurrenceEmbeddingSource() { return source; },
    async rescheduleOrFail(_job: unknown, _message: string, value: Date | null) { persistedRetryAt = value; return true; },
  } as unknown as CardEnrichmentRepository;
  const logs = {
    async create(input: CreateSystemEventLogInput) { event = input; return {} as never; },
  } as SystemEventLogRepository;
  const upstreamError = Object.assign(new Error("UPSTREAM_AI_ERROR"), {
    code: "UPSTREAM_AI_ERROR",
    upstreamCode: "AI_PROVIDER_TIMEOUT",
    failureKind: "timeout",
  });
  const failingProvider: AIProvider = {
    ...aiProvider,
    async generateChatTextStream() { throw upstreamError; },
  };

  await new PhraseOccurrenceEmbeddingWorkerService(
    repository,
    provider,
    logs,
    {},
    undefined,
    failingProvider,
  ).claimAndProcess("worker-1");

  assert.equal(persistedRetryAt, null);
  assert.ok(event);
  assert.equal(event.event, "phrase.occurrence_embedding.failed");
  assert.equal(event.level, "error");
  assert.equal(event.status, "failed");
  const metadata = event.metadata as Record<string, unknown>;
  assert.equal(metadata.nextAttemptAt, null);
  assert.equal(metadata.upstreamCode, "AI_PROVIDER_TIMEOUT");
  assert.equal(metadata.failureKind, "timeout");
  assert.equal(metadata.retryableUpstream, true);
});
