#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || "$1" != "--email" || -z "$2" ]]; then
  echo "Usage: $0 --email <test-account-email> [--anchor <surface-text>]" >&2
  exit 2
fi

email="$2"
anchor=""
if [[ $# -eq 4 && "$3" == "--anchor" && -n "$4" ]]; then
  anchor="$4"
elif [[ $# -ne 2 ]]; then
  echo "Usage: $0 --email <test-account-email> [--anchor <surface-text>]" >&2
  exit 2
fi
ssh oio-main "bash -s -- '$email' '$anchor'" <<'REMOTE'
set -euo pipefail
email="$1"
anchor="$2"
cd /opt/oio-production
TARGET_EMAIL="$email" TARGET_ANCHOR="$anchor" node --env-file=.env --import tsx <<'NODE'
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
const userId = users[0].id;
const anchorFilter = String(process.env.TARGET_ANCHOR || "").trim() || null;
const promptVersion = "phrase_relation_judge_v2";
const counts = await prisma.phraseOccurrenceRelationDecision.groupBy({
  by: ["status"], where: { userId, promptVersion }, _count: { _all: true },
});
console.log(JSON.stringify({ type: "counts", values: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) }));
const selected = await prisma.$queryRaw`
  SELECT anchor."surfaceText" AS "anchorSurface", anchor_segment."text" AS "anchorSentence",
         candidate."surfaceText" AS "candidateSurface", candidate_segment."text" AS "candidateSentence",
         decision."selectedSemanticScore" AS "recallScore"
    FROM "phrase_occurrence_relation_decisions" decision
    JOIN "phrase_occurrences" anchor ON anchor."id" = decision."anchorOccurrenceId"
    JOIN "phrase_occurrences" candidate ON candidate."id" = decision."selectedOccurrenceId"
    JOIN LATERAL (SELECT segment."text" FROM "card_rewrite_segments" segment WHERE segment."entryId" = anchor."cardId" AND (segment."id" = anchor."segmentId" OR position(lower(anchor."surfaceText") in lower(segment."text")) > 0) ORDER BY (segment."id" = anchor."segmentId") DESC, segment."ordinal" ASC LIMIT 1) anchor_segment ON TRUE
    JOIN LATERAL (SELECT segment."text" FROM "card_rewrite_segments" segment WHERE segment."entryId" = candidate."cardId" AND (segment."id" = candidate."segmentId" OR position(lower(candidate."surfaceText") in lower(segment."text")) > 0) ORDER BY (segment."id" = candidate."segmentId") DESC, segment."ordinal" ASC LIMIT 1) candidate_segment ON TRUE
   WHERE decision."userId" = ${userId} AND decision."promptVersion" = ${promptVersion} AND decision."status" = ${"selected"}
     AND (${anchorFilter}::text IS NULL OR lower(anchor."surfaceText") = lower(${anchorFilter}))
   ORDER BY decision."updatedAt" DESC
   LIMIT 20`;
for (const row of selected) console.log(JSON.stringify({ type: "selected", ...row }));
const rejected = await prisma.$queryRaw`
  SELECT anchor."surfaceText" AS "anchorSurface", anchor_segment."text" AS "anchorSentence",
         candidate."surfaceText" AS "candidateSurface", candidate_segment."text" AS "candidateSentence",
         ((1 - (candidate_phrase_embedding."embedding" <=> anchor_phrase_embedding."embedding")) * 0.30
           + (1 - (candidate_context_embedding."embedding" <=> anchor_context_embedding."embedding")) * 0.70)::double precision AS "recallScore"
    FROM "phrase_occurrence_relation_decisions" decision
    JOIN "phrase_occurrences" anchor ON anchor."id" = decision."anchorOccurrenceId"
    JOIN LATERAL jsonb_array_elements_text(decision."candidateOccurrenceIds") AS candidate_ids("occurrenceId") ON TRUE
    JOIN "phrase_occurrences" candidate ON candidate."id" = candidate_ids."occurrenceId"
    JOIN "phrase_occurrence_embeddings" anchor_context_embedding ON anchor_context_embedding."occurrenceId" = anchor."id" AND anchor_context_embedding."representationVersion" = ${"usage_meaning_v2"}
    JOIN "phrase_occurrence_embeddings" candidate_context_embedding ON candidate_context_embedding."occurrenceId" = candidate."id" AND candidate_context_embedding."modelVersion" = anchor_context_embedding."modelVersion" AND candidate_context_embedding."representationVersion" = anchor_context_embedding."representationVersion"
    JOIN "phrase_embeddings" anchor_phrase_embedding ON anchor_phrase_embedding."phraseId" = anchor."phraseId" AND anchor_phrase_embedding."modelVersion" = anchor_context_embedding."modelVersion"
    JOIN "phrase_embeddings" candidate_phrase_embedding ON candidate_phrase_embedding."phraseId" = candidate."phraseId" AND candidate_phrase_embedding."modelVersion" = anchor_context_embedding."modelVersion"
    JOIN LATERAL (SELECT segment."text" FROM "card_rewrite_segments" segment WHERE segment."entryId" = anchor."cardId" AND (segment."id" = anchor."segmentId" OR position(lower(anchor."surfaceText") in lower(segment."text")) > 0) ORDER BY (segment."id" = anchor."segmentId") DESC, segment."ordinal" ASC LIMIT 1) anchor_segment ON TRUE
    JOIN LATERAL (SELECT segment."text" FROM "card_rewrite_segments" segment WHERE segment."entryId" = candidate."cardId" AND (segment."id" = candidate."segmentId" OR position(lower(candidate."surfaceText") in lower(segment."text")) > 0) ORDER BY (segment."id" = candidate."segmentId") DESC, segment."ordinal" ASC LIMIT 1) candidate_segment ON TRUE
   WHERE decision."userId" = ${userId} AND decision."promptVersion" = ${promptVersion} AND decision."status" = ${"none"}
     AND (${anchorFilter}::text IS NULL OR lower(anchor."surfaceText") = lower(${anchorFilter}))
   ORDER BY "recallScore" DESC, decision."updatedAt" DESC
   LIMIT 30`;
for (const row of rejected) console.log(JSON.stringify({ type: "rejected_candidate", ...row }));
await prisma.$disconnect();
NODE
REMOTE
