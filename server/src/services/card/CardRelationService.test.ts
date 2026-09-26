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
