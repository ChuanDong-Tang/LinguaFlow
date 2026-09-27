#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--email" || -z "${2:-}" || "${3:-}" != "--anchor-limit" || ! "${4:-}" =~ ^[0-9]+$ || "${5:-}" != "--confirm-production" || $# -ne 5 ]]; then
  echo "Usage: $0 --email <email> --anchor-limit <1-10> --confirm-production" >&2
  exit 2
fi
if (( $4 < 1 || $4 > 10 )); then
  echo "anchor limit must be 1-10" >&2
  exit 2
fi

ssh oio-main "bash -s -- '$2' '$4'" <<'REMOTE'
set -euo pipefail
cd /opt/oio-production
TARGET_EMAIL="$1" ANCHOR_LIMIT="$2" node --env-file=.env --import tsx <<'NODE'
import { PrismaClient } from "@prisma/client";
import { enqueuePhraseOccurrenceEmbeddingForOccurrence } from "./server/src/infrastructure/repository/PhraseOccurrenceEmbeddingJobs.ts";

const prisma = new PrismaClient();
const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
const userId = users[0].id;
const limit = Number(process.env.ANCHOR_LIMIT);
const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
const rows = await prisma.$queryRawUnsafe(`
  WITH anchors AS (
    SELECT occurrence."id", occurrence."phraseId", occurrence."cardId", phrase_embedding."embedding", phrase."languageCode"
      FROM "phrase_occurrences" occurrence
      JOIN "phrases" phrase ON phrase."id" = occurrence."phraseId" AND phrase."status" = 'normalized'
      JOIN "phrase_embeddings" phrase_embedding ON phrase_embedding."phraseId" = occurrence."phraseId" AND phrase_embedding."modelVersion" = $2
     WHERE occurrence."userId" = $1 AND occurrence."sourceField" = 'ai_expression' AND occurrence."clozeBlankId" IS NOT NULL
     ORDER BY occurrence."cardCreatedAt" DESC, occurrence."id" DESC
     LIMIT $3
  ), candidates AS (
    SELECT anchors."id" AS "anchorId", candidate_occurrence."id" AS "candidateId",
           ROW_NUMBER() OVER (PARTITION BY anchors."id" ORDER BY candidate_embedding."embedding" <=> anchors."embedding", candidate_occurrence."cardCreatedAt" DESC) AS rank
      FROM anchors
      JOIN "phrase_embeddings" candidate_embedding ON candidate_embedding."userId" = $1 AND candidate_embedding."modelVersion" = $2 AND candidate_embedding."phraseId" <> anchors."phraseId"
      JOIN "phrases" candidate_phrase ON candidate_phrase."id" = candidate_embedding."phraseId" AND candidate_phrase."languageCode" = anchors."languageCode" AND candidate_phrase."status" = 'normalized'
      JOIN "phrase_occurrences" candidate_occurrence ON candidate_occurrence."phraseId" = candidate_phrase."id" AND candidate_occurrence."userId" = $1 AND candidate_occurrence."sourceField" = 'ai_expression' AND candidate_occurrence."cardId" <> anchors."cardId"
     WHERE (1 - (candidate_embedding."embedding" <=> anchors."embedding")) >= 0.72
  )
  SELECT DISTINCT id FROM (
    SELECT "id" FROM anchors
    UNION ALL
    SELECT "candidateId" AS "id" FROM candidates WHERE rank <= 2
  ) selected
  LIMIT 30`, userId, modelVersion, limit);
if (!rows.length) throw new Error("RELATION_SAMPLE_OCCURRENCES_NOT_FOUND");
await prisma.$transaction(async (tx) => {
  for (const row of rows) await enqueuePhraseOccurrenceEmbeddingForOccurrence(tx, row.id);
});
console.log(`sample_occurrences=${rows.length}`);
console.log("enqueued_scope=target_user_relation_sample");
await prisma.$disconnect();
NODE
REMOTE
