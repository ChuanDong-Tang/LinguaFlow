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
const representationVersion = "usage_meaning_v2";
const promptVersion = "phrase_occurrence_context_meaning_v2_1";
const rows = await prisma.$queryRawUnsafe(`
  WITH anchors AS (
    SELECT occurrence."id" AS "anchorId", occurrence."phraseId", occurrence."cardId",
           occurrence."surfaceText" AS "anchorSurface", phrase."languageCode",
           phrase_embedding."embedding" AS "phraseEmbedding",
           context_embedding."embedding" AS "contextEmbedding",
           context_embedding."polarity" AS "polarity",
           context_embedding."modality" AS "modality",
           context_embedding."meaningKind" AS "meaningKind"
      FROM "phrase_occurrences" occurrence
      JOIN "phrases" phrase
        ON phrase."id" = occurrence."phraseId"
       AND phrase."userId" = occurrence."userId"
       AND phrase."status" = 'normalized'
      JOIN "phrase_embeddings" phrase_embedding
        ON phrase_embedding."phraseId" = occurrence."phraseId"
       AND phrase_embedding."userId" = occurrence."userId"
       AND phrase_embedding."modelVersion" = $2
      JOIN "phrase_occurrence_embeddings" context_embedding
        ON context_embedding."occurrenceId" = occurrence."id"
       AND context_embedding."userId" = occurrence."userId"
       AND context_embedding."modelVersion" = $2
       AND context_embedding."representationVersion" = $3
       AND context_embedding."promptVersion" = $4
     WHERE occurrence."userId" = $1
       AND occurrence."sourceField" = 'ai_expression'
       AND occurrence."clozeBlankId" IS NOT NULL
  ), raw_candidates AS (
    SELECT anchors."anchorId", anchors."anchorSurface", candidate_occurrence."surfaceText" AS "candidateSurface",
           anchors."polarity" AS "anchorPolarity", candidate_context_embedding."polarity" AS "candidatePolarity",
           anchors."modality" AS "anchorModality", candidate_context_embedding."modality" AS "candidateModality",
           anchors."meaningKind" AS "anchorMeaningKind", candidate_context_embedding."meaningKind" AS "candidateMeaningKind"
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
      JOIN "phrase_occurrence_embeddings" candidate_context_embedding
        ON candidate_context_embedding."occurrenceId" = candidate_occurrence."id"
       AND candidate_context_embedding."userId" = $1
       AND candidate_context_embedding."modelVersion" = $2
       AND candidate_context_embedding."representationVersion" = $3
       AND candidate_context_embedding."promptVersion" = $4
     WHERE (1 - (candidate_phrase_embedding."embedding" <=> anchors."phraseEmbedding")) >= 0.72
       AND (1 - (candidate_context_embedding."embedding" <=> anchors."contextEmbedding")) >= 0.45
  ), compatible AS (
    SELECT * FROM raw_candidates
     WHERE "anchorPolarity" IS NOT NULL
       AND "candidatePolarity" = "anchorPolarity"
       AND "anchorMeaningKind" IS NOT NULL
       AND "anchorMeaningKind" <> 'other:missing'
       AND "candidateMeaningKind" = "anchorMeaningKind"
       AND "candidateMeaningKind" <> 'other:missing'
       AND (
         "anchorPolarity" = 'neutral'
         OR ("anchorModality" IS NOT NULL AND "candidateModality" = "anchorModality")
       )
  )
  SELECT
    (SELECT COUNT(*)::int FROM anchors) AS "coveredAnchors",
    (SELECT COUNT(DISTINCT "anchorId")::int FROM compatible) AS "anchorsWithCandidates",
    (SELECT COUNT(*)::int FROM raw_candidates) AS "rawCandidatePairs",
    (SELECT COUNT(*)::int FROM compatible) AS "candidatePairs",
    (SELECT COUNT(*)::int FROM raw_candidates
      WHERE "anchorPolarity" IS DISTINCT FROM "candidatePolarity"
         OR "anchorMeaningKind" IS DISTINCT FROM "candidateMeaningKind"
         OR ("anchorPolarity" <> 'neutral' AND "anchorModality" IS DISTINCT FROM "candidateModality")) AS "featureIncompatibleRejected",
    (SELECT COUNT(*)::int FROM compatible
      WHERE lower("anchorSurface") = 'really want'
        AND lower("candidateSurface") = 'they might want') AS "knownNegativeSurviving",
    (SELECT COUNT(*)::int FROM compatible
      WHERE (lower("anchorSurface") = 'really addictive' AND lower("candidateSurface") = 'so addictive')
         OR (lower("anchorSurface") = 'so addictive' AND lower("candidateSurface") = 'really addictive')) AS "knownPositiveSurviving",
    (SELECT COUNT(*)::int FROM compatible
      WHERE (lower("anchorSurface") = 'something' AND lower("candidateSurface") = 'had')
         OR (lower("anchorSurface") = 'had' AND lower("candidateSurface") = 'something')) AS "knownTypeMismatchSurviving"
`, userId, modelVersion, representationVersion, promptVersion);
const result = rows[0] || {};
for (const [key, value] of Object.entries(result)) console.log(`${key}=${Number(value || 0)}`);
await prisma.$disconnect();
NODE
REMOTE
