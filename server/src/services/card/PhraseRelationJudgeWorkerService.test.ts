import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { phraseRelationJudgeHashInput, type PhraseRelationJudgeSource } from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import type { CardEnrichmentJobEntity, CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { AIProvider } from "@lf/core/ports/ai/AIProvider.js";
import { PhraseRelationJudgeWorkerService } from "./PhraseRelationJudgeWorkerService.js";

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
    inputVersion: "phrase_relation_judge_v2:hash", workerId: "worker-1", payload: {},
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
  assert.deepEqual(completions, [{ selectedOccurrenceId: "good", promptVersion: "phrase_relation_judge_v2", provider: "test", model: "judge-model" }]);
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
