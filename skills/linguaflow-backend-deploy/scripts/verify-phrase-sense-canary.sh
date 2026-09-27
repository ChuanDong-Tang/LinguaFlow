#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--email" || -z "${2:-}" || $# -ne 2 ]]; then
  echo "Usage: $0 --email <email>" >&2
  exit 2
fi

ssh oio-main "bash -s -- '$2'" <<'REMOTE'
set -euo pipefail
cd /opt/oio-production
TARGET_EMAIL="$1" node --env-file=.env --import tsx <<'NODE'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  where: { email: process.env.TARGET_EMAIL },
  select: { id: true },
  take: 2,
});
if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
const userId = users[0].id;
const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
const representationVersion = "usage_meaning_v1";
const rows = await prisma.$queryRawUnsafe(`
  WITH anchors AS (
    SELECT occurrence."id" AS "anchorId", occurrence."phraseId", occurrence."cardId",
           phrase."canonicalText" AS "anchorCanonical", phrase."languageCode",
           phrase_embedding."embedding" AS "phraseEmbedding",
           sense_embedding."embedding" AS "senseEmbedding"
      FROM "phrase_occurrences" occurrence
      JOIN "phrases" phrase
        ON phrase."id" = occurrence."phraseId"
       AND phrase."userId" = occurrence."userId"
       AND phrase."status" = 'normalized'
      JOIN "phrase_embeddings" phrase_embedding
        ON phrase_embedding."phraseId" = occurrence."phraseId"
       AND phrase_embedding."userId" = occurrence."userId"
       AND phrase_embedding."modelVersion" = $2
      JOIN "phrase_occurrence_embeddings" sense_embedding
        ON sense_embedding."occurrenceId" = occurrence."id"
       AND sense_embedding."userId" = occurrence."userId"
       AND sense_embedding."modelVersion" = $2
       AND sense_embedding."representationVersion" = $3
     WHERE occurrence."userId" = $1
       AND occurrence."sourceField" = 'ai_expression'
       AND occurrence."clozeBlankId" IS NOT NULL
  ), candidates AS (
    SELECT anchors."anchorId", anchors."anchorCanonical", candidate_phrase."canonicalText" AS "candidateCanonical",
           candidate_occurrence."id" AS "candidateId",
           (1 - (candidate_phrase_embedding."embedding" <=> anchors."phraseEmbedding"))::double precision AS "phraseScore",
           (1 - (candidate_sense_embedding."embedding" <=> anchors."senseEmbedding"))::double precision AS "senseScore"
      FROM anchors
      JOIN "phrase_embeddings" candidate_phrase_embedding
        ON candidate_phrase_embedding."userId" = $1
       AND candidate_phrase_embedding."modelVersion" = $2
       AND candidate_phrase_embedding."phraseId" <> anchors."phraseId"
      JOIN "phrases" candidate_phrase
        ON candidate_phrase."id" = candidate_phrase_embedding."phraseId"
       AND candidate_phrase."userId" = $1
       AND candidate_phrase."languageCode" = anchors."languageCode"
       AND candidate_phrase."status" = 'normalized'
      JOIN "phrase_occurrences" candidate_occurrence
        ON candidate_occurrence."phraseId" = candidate_phrase."id"
       AND candidate_occurrence."userId" = $1
       AND candidate_occurrence."sourceField" = 'ai_expression'
       AND candidate_occurrence."cardId" <> anchors."cardId"
      JOIN "phrase_occurrence_embeddings" candidate_sense_embedding
        ON candidate_sense_embedding."occurrenceId" = candidate_occurrence."id"
       AND candidate_sense_embedding."userId" = $1
       AND candidate_sense_embedding."modelVersion" = $2
       AND candidate_sense_embedding."representationVersion" = $3
     WHERE (1 - (candidate_phrase_embedding."embedding" <=> anchors."phraseEmbedding")) >= 0.72
       AND (1 - (candidate_sense_embedding."embedding" <=> anchors."senseEmbedding")) >= 0.45
  )
  SELECT
    (SELECT COUNT(*)::int FROM anchors) AS "coveredAnchors",
    COUNT(DISTINCT "anchorId")::int AS "anchorsWithCandidates",
    COUNT(*)::int AS "candidatePairs",
    COUNT(*) FILTER (
      WHERE lower("anchorCanonical") = 'crack up'
        AND lower("candidateCanonical") = 'crack'
    )::int AS "knownNegativeSurviving"
    FROM candidates`, userId, modelVersion, representationVersion);
const result = rows[0] || {};
console.log(`covered_cloze_anchors=${Number(result.coveredAnchors || 0)}`);
console.log(`anchors_with_candidates=${Number(result.anchorsWithCandidates || 0)}`);
console.log(`candidate_pairs=${Number(result.candidatePairs || 0)}`);
console.log(`known_negative_surviving=${Number(result.knownNegativeSurviving || 0)}`);
await prisma.$disconnect();
NODE
REMOTE
