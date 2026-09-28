#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --count <1-20> --confirm-production" >&2
  exit 2
}

[[ "${1:-}" == "--count" && -n "${2:-}" && "${3:-}" == "--confirm-production" && $# -eq 3 ]] || usage
count="$2"
[[ "$count" =~ ^[0-9]+$ ]] || usage
(( count >= 1 && count <= 20 )) || usage

ssh oio-main "set -euo pipefail
  cd /opt/oio-production
  COUNT='$count' node --env-file=.env --import tsx" <<'NODE'
import { PrismaClient } from "@prisma/client";
import { PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION } from "@lf/core/Prompts/phraseOccurrenceSensePrompt.js";
import { PrismaCardEnrichmentRepository } from "./server/src/infrastructure/repository/PrismaCardEnrichmentRepository.ts";

const prisma = new PrismaClient();
try {
  const count = Number(process.env.COUNT);
  const continuousEnabled = String(process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED || "false").toLowerCase() === "true";
  const continuousTarget = String(process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID || "").trim();
  if (continuousEnabled && !continuousTarget) throw new Error("GLOBAL_CONTINUOUS_BACKFILL_MUST_BE_DISABLED");

  const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
  const repository = new PrismaCardEnrichmentRepository(prisma);
  const before = await prisma.cardEnrichmentJob.count({
    where: {
      jobType: "generate_phrase_occurrence_embedding",
      status: { in: ["queued", "processing"] },
      inputVersion: { contains: ":usage_meaning_v2:" },
    },
  });
  if (before !== 0) throw new Error(`DIAGNOSTIC_BATCH_REQUIRES_EMPTY_QUEUE_${before}`);

  const enqueued = await repository.enqueueMissingPhraseOccurrenceEmbeddingJobs({
    modelVersion,
    representationVersion: "usage_meaning_v2",
    promptVersion: PHRASE_OCCURRENCE_CONTEXT_MEANING_PROMPT_VERSION,
    limit: count,
    maxOutstanding: count,
  });
  const after = await prisma.cardEnrichmentJob.count({
    where: {
      jobType: "generate_phrase_occurrence_embedding",
      status: { in: ["queued", "processing"] },
      inputVersion: { contains: ":usage_meaning_v2:" },
    },
  });
  if (enqueued > count || after > count) throw new Error("DIAGNOSTIC_BATCH_BOUND_EXCEEDED");
  console.log(`requested=${count}`);
  console.log(`enqueued=${enqueued}`);
  console.log(`outstanding=${after}`);
} finally {
  await prisma.$disconnect();
}
NODE
