#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--email" || -z "${2:-}" || "${3:-}" != "--prompt-version" || -z "${4:-}" || "${5:-}" != "--max" || ! "${6:-}" =~ ^[0-9]+$ || "${7:-}" != "--confirm-production" || $# -ne 7 ]]; then
  echo "Usage: $0 --email <email> --prompt-version <version> --max <1-100> --confirm-production" >&2
  exit 2
fi
if (( $6 < 1 || $6 > 100 )); then
  echo "max must be 1-100" >&2
  exit 2
fi

ssh oio-main "bash -s -- '$2' '$4' '$6'" <<'REMOTE'
set -euo pipefail
cd /opt/oio-production
TARGET_EMAIL="$1" PROMPT_VERSION="$2" MAX_RETRIES="$3" node --env-file=.env --import tsx <<'NODE'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  where: { email: process.env.TARGET_EMAIL },
  select: { id: true },
  take: 2,
});
if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
const userId = users[0].id;
const promptVersion = String(process.env.PROMPT_VERSION || "").trim();
const maxRetries = Number(process.env.MAX_RETRIES);
const jobs = await prisma.cardEnrichmentJob.findMany({
  where: {
    userId,
    sourceKind: "phrase_occurrence",
    jobType: "generate_phrase_occurrence_embedding",
    status: "failed",
    inputVersion: { contains: `:usage_meaning_v2:${promptVersion}:` },
  },
  select: { id: true },
  orderBy: [{ failedAt: "asc" }, { id: "asc" }],
  take: maxRetries + 1,
});
if (jobs.length > maxRetries) throw new Error(`FAILED_JOB_CARDINALITY_EXCEEDS_MAX_${jobs.length}`);
if (!jobs.length) {
  console.log("matched_failed_jobs=0");
  await prisma.$disconnect();
  process.exit(0);
}
const result = await prisma.cardEnrichmentJob.updateMany({
  where: { id: { in: jobs.map((job) => job.id) }, status: "failed", userId },
  data: {
    status: "queued",
    attempts: 0,
    availableAt: new Date(),
    processingAt: null,
    leaseExpiresAt: null,
    workerId: null,
    failedAt: null,
    completedAt: null,
  },
});
if (result.count !== jobs.length) throw new Error(`RETRY_CARDINALITY_MISMATCH_${result.count}_${jobs.length}`);
console.log(`matched_failed_jobs=${jobs.length}`);
console.log(`requeued_jobs=${result.count}`);
console.log("retry_scope=target_user_current_prompt_failed_only");
await prisma.$disconnect();
NODE
REMOTE
