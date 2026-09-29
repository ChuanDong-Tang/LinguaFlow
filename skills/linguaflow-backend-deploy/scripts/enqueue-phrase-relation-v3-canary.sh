#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --email <email> --count <1-20> --confirm-production" >&2
  exit 2
}

[[ "${1:-}" == "--email" && -n "${2:-}" && "${3:-}" == "--count" && -n "${4:-}" && "${5:-}" == "--confirm-production" && $# -eq 5 ]] || usage
email="$2"
count="$4"
[[ "$count" =~ ^[0-9]+$ ]] || usage
(( count >= 1 && count <= 20 )) || usage

ssh oio-main "set -euo pipefail
  cd /opt/oio-production
  TARGET_EMAIL='$email' COUNT='$count' node --env-file=.env --import tsx" <<'NODE'
import { PrismaClient } from "@prisma/client";
import { PHRASE_RELATION_JUDGE_PROMPT_VERSION } from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import { PrismaCardEnrichmentRepository } from "./server/src/infrastructure/repository/PrismaCardEnrichmentRepository.ts";

const prisma = new PrismaClient();
try {
  const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
  if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
  const userId = users[0].id;
  const count = Number(process.env.COUNT);
  const configuredTarget = process.env.RELATED_PHRASE_JUDGE_USER_ID?.trim();
  if (configuredTarget && configuredTarget !== userId) throw new Error("TARGET_USER_NOT_IN_JUDGE_SCOPE");
  const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
  const repository = new PrismaCardEnrichmentRepository(prisma);
  const before = await prisma.cardEnrichmentJob.count({
    where: { jobType: "judge_phrase_relation", userId, status: { in: ["queued", "processing"] }, priority: { lt: 0 } },
  });
  if (before !== 0) throw new Error(`CANARY_REQUIRES_EMPTY_TARGET_QUEUE_${before}`);
  const enqueued = await repository.enqueueMissingPhraseRelationJudgeJobs({
    modelVersion,
    representationVersion: process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION || "usage_meaning_v2",
    promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION,
    minPhraseSimilarity: Number(process.env.RELATED_PHRASE_MIN_SIMILARITY || 0.72),
    minRepresentationSimilarity: Number(process.env.RELATED_PHRASE_SENSE_MIN_SIMILARITY || 0.45),
    representationWeight: Number(process.env.RELATED_PHRASE_SENSE_WEIGHT || 0.70),
    limit: count,
    maxOutstanding: count,
    userId,
  });
  const after = await prisma.cardEnrichmentJob.count({
    where: { jobType: "judge_phrase_relation", userId, status: { in: ["queued", "processing"] }, priority: { lt: 0 } },
  });
  if (enqueued > count || after > count) throw new Error("CANARY_BATCH_BOUND_EXCEEDED");
  console.log(`requested=${count}`);
  console.log(`enqueued=${enqueued}`);
  console.log(`outstanding=${after}`);
} finally {
  await prisma.$disconnect();
}
NODE
