import assert from "node:assert/strict";
import test from "node:test";
import { CardRelationService } from "./CardRelationService.js";

const current = {
  phraseId: "phrase-current",
  phrase: "fit",
  sourceKind: "card",
  sourceId: "related-card",
  topic: "clothes",
  evidence: "clozed",
  surfaceText: "matches",
  sentence: "The color matches your shoes.",
  currentSegmentId: "segment-current",
  currentSurfaceText: "fits",
  currentStartUtf16: 12,
  currentEndUtf16: 16,
  currentSentence: "This jacket fits me well.",
  cardCreatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

test("prefers semantic phrase relations and preserves both sentence anchors", async () => {
  const repository = {
    findSemanticallyRelatedPhrases: async () => [{ ...current, semanticScore: 0.84 }],
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
  });

  const relations = await service.relatedPhrases("user-1", "card:current-card", 10);

  assert.equal(relations.length, 1);
  assert.deepEqual(relations[0]?.reason, {
    type: "phrase",
    phraseId: "phrase-current",
    phrase: "fit",
    evidence: "clozed",
    surfaceText: "matches",
    sentence: "The color matches your shoes.",
    currentSegmentId: "segment-current",
    currentSurfaceText: "fits",
    currentStartUtf16: 12,
    currentEndUtf16: 16,
    currentSentence: "This jacket fits me well.",
    matchMode: "semantic",
    semanticScore: 0.84,
  });
});

test("does not fall back to exact word or phrase history when semantic matches are unavailable", async () => {
  const repository = {
    findSemanticallyRelatedPhrases: async () => [],
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
  });

  const relations = await service.relatedPhrases("user-1", "card:current-card", 10);

  assert.deepEqual(relations, []);
});

test("uses occurrence context only for the targeted rollout user", async () => {
  const calls: string[] = [];
  let contextInput: Record<string, unknown> | null = null;
  const repository = {
    findContextuallyRelatedPhrases: async (input: Record<string, unknown>) => {
      calls.push("context");
      contextInput = input;
      return [{ ...current, semanticScore: 0.91 }];
    },
    findSemanticallyRelatedPhrases: async () => { calls.push("phrase"); return [{ ...current, semanticScore: 0.84 }]; },
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
    contextRelationsEnabled: true,
    contextRelationsUserId: "user-target",
    minContextSimilarity: 0.8,
    contextRepresentationVersion: "usage_meaning_v1",
    minSenseSimilarity: 0.46,
    senseWeight: 0.75,
  });

  const target = await service.relatedPhrases("user-target", "card:current-card", 10);
  const other = await service.relatedPhrases("user-other", "card:current-card", 10);

  assert.deepEqual(calls, ["context", "phrase"]);
  assert.deepEqual(contextInput, {
    userId: "user-target",
    sourceId: "current-card",
    modelVersion: "embedding-v1",
    representationVersion: "usage_meaning_v1",
    minPhraseSimilarity: 0.72,
    minRepresentationSimilarity: 0.46,
    representationWeight: 0.75,
    requireSemanticCompatibility: false,
    limit: 10,
  });
  assert.equal(target[0]?.reason.semanticScore, 0.91);
  assert.equal(other[0]?.reason.semanticScore, 0.84);
});

test("V2 enables semantic feature compatibility filtering", async () => {
  const contextInputs: Array<Record<string, unknown>> = [];
  const repository = {
    findContextuallyRelatedPhrases: async (input: Record<string, unknown>) => {
      contextInputs.push(input);
      return [];
    },
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
    contextRelationsEnabled: true,
    contextRelationsUserId: "user-target",
    contextRepresentationVersion: "usage_meaning_v2",
  });

  await service.relatedPhrases("user-target", "card:current-card", 10);

  assert.equal(contextInputs[0]?.requireSemanticCompatibility, true);
});

test("judge rollout serves only one persisted relation and fails closed without a decision", async () => {
  const calls: string[] = [];
  const repository = {
    findVerifiedRelatedPhrases: async () => {
      calls.push("verified");
      return [{ ...current, semanticScore: 0.93 }, { ...current, sourceId: "second-card", semanticScore: 0.92 }];
    },
    findContextuallyRelatedPhrases: async () => {
      calls.push("context");
      return [{ ...current, semanticScore: 0.99 }];
    },
    findSemanticallyRelatedPhrases: async () => {
      calls.push("phrase");
      return [{ ...current, semanticScore: 0.99 }];
    },
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
    contextRelationsEnabled: true,
    phraseJudgeEnabled: true,
    phraseJudgeUserId: "user-target",
  });

  const target = await service.relatedPhrases("user-target", "card:current-card", 100);
  const other = await service.relatedPhrases("user-other", "card:current-card", 100);

  assert.deepEqual(calls, ["verified", "context"]);
  assert.equal(target.length, 1);
  assert.equal(other.length, 1);
});

test("judge rollout does not fall back to vector results while a decision is missing", async () => {
  let fallbackCalls = 0;
  const repository = {
    findVerifiedRelatedPhrases: async () => [],
    findContextuallyRelatedPhrases: async () => { fallbackCalls += 1; return [{ ...current, semanticScore: 0.99 }]; },
    findSemanticallyRelatedPhrases: async () => { fallbackCalls += 1; return [{ ...current, semanticScore: 0.99 }]; },
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
    phraseJudgeEnabled: true,
    phraseJudgeUserId: "user-target",
  });

  assert.deepEqual(await service.relatedPhrases("user-target", "card:current-card", 10), []);
  assert.equal(fallbackCalls, 0);
});

test("keeps topic relations when no semantic language relation exists", async () => {
  const repository = {
    findRelatedTopics: async () => [{ sourceId: "topic-card", topic: "new house renovation", score: 0.88 }],
    findSemanticallyRelatedPhrases: async () => [],
    findRelationPreviews: async () => [],
  };
  const service = new CardRelationService(repository as never, {
    modelVersion: "embedding-v1",
    minTopicSimilarity: 0.7,
  });

  const relations = await service.relations("user-1", "card:current-card", 10);

  assert.equal(relations.length, 1);
  assert.equal(relations[0]?.recordId, "card:topic-card");
  assert.deepEqual(relations[0]?.reasons, [{ type: "topic", score: 0.88, modelVersion: "embedding-v1" }]);
});
