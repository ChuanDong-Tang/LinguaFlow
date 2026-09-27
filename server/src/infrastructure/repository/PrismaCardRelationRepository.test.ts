import assert from "node:assert/strict";
import test from "node:test";
import { PrismaCardRelationRepository } from "./PrismaCardRelationRepository.js";

test("contextual phrase lookup recalls by phrase and ranks with a versioned sense representation", async () => {
  let sql = "";
  let parameters: unknown[] = [];
  const prisma = {
    async $queryRawUnsafe(query: string, ...values: unknown[]) {
      sql = query;
      parameters = values;
      return [{ semanticScore: "0.81" }];
    },
  };
  const repository = new PrismaCardRelationRepository(prisma as never);

  const rows = await repository.findContextuallyRelatedPhrases({
    userId: "user-1",
    sourceId: "card-1",
    modelVersion: "embedding-v1",
    representationVersion: "usage_meaning_v1",
    minPhraseSimilarity: 0.72,
    minRepresentationSimilarity: 0.45,
    representationWeight: 0.70,
    requireSemanticCompatibility: false,
    limit: 4,
  });

  assert.match(sql, /current_context_embedding\."representationVersion" = \$4/u);
  assert.match(sql, /candidate_context_embedding\."representationVersion" = \$4/u);
  assert.match(sql, /\* \(1 - \$7::double precision\)/u);
  assert.match(sql, />= \$5/u);
  assert.match(sql, />= \$6/u);
  assert.match(sql, /\$9::boolean = false/u);
  assert.match(sql, /LIMIT \$8/u);
  assert.deepEqual(parameters, [
    "user-1",
    "card-1",
    "embedding-v1",
    "usage_meaning_v1",
    0.72,
    0.45,
    0.70,
    4,
    false,
  ]);
  assert.equal(rows[0]?.semanticScore, 0.81);
});

test("V2 requires matching polarity and external modality in the same lookup", async () => {
  let sql = "";
  let parameters: unknown[] = [];
  const prisma = {
    async $queryRawUnsafe(query: string, ...values: unknown[]) {
      sql = query;
      parameters = values;
      return [];
    },
  };
  const repository = new PrismaCardRelationRepository(prisma as never);

  await repository.findContextuallyRelatedPhrases({
    userId: "user-1",
    sourceId: "card-1",
    modelVersion: "embedding-v1",
    representationVersion: "usage_meaning_v2",
    minPhraseSimilarity: 0.72,
    minRepresentationSimilarity: 0.45,
    representationWeight: 0.70,
    requireSemanticCompatibility: true,
    limit: 4,
  });

  assert.match(sql, /candidate_context_embedding\."polarity" = anchors\."currentPolarity"/u);
  assert.match(sql, /candidate_context_embedding\."modality" = anchors\."currentModality"/u);
  assert.equal(parameters.at(-1), true);
});
