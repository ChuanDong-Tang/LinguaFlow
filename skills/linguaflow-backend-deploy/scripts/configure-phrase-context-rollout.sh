#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --status | --target-sense-backfill <email> --confirm-production | --enable-target-sense-canary <email> --confirm-production | --enable-target-context-v2-canary <email> --confirm-production | --enable-target-context-v2-low <email> --confirm-production | --enable-target-sense-relations <email> --confirm-production | --broad-context-v2-backfill --confirm-production | --throttle-all-low --confirm-production | --broad-backfill --confirm-production | --enable-all-relations --confirm-production | --stop-backfill --confirm-production | --disable --confirm-production" >&2
  exit 2
}

action="${1:-}"
if [[ "$action" == "--status" ]]; then
  [[ $# -eq 1 ]] || usage
  ssh oio-main 'set -euo pipefail
    cd /opt/oio-production
    node --env-file=.env --import tsx <<'"'"'NODE'"'"'
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
const targetUserId = String(process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID || "").trim() || null;
const backfillRepresentation = String(process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION || "marked_sentence_v1").trim();
const relationRepresentation = String(process.env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION || "marked_sentence_v1").trim();
const promptVersion = backfillRepresentation === "usage_meaning_v2"
  ? "phrase_occurrence_context_meaning_v2_1"
  : backfillRepresentation === "usage_meaning_v1"
    ? "phrase_occurrence_sense_v1"
    : "direct_embedding_v1";
const backfillPrefix = `phrase_occurrence_embedding_backfill_v2:${backfillRepresentation}:${promptVersion}:${modelVersion}:`;
const senseInputMarker = `:${backfillRepresentation}:`;
const requiresPromptVersion = backfillRepresentation.startsWith("usage_meaning_");
const [eligible, embedded, handled, jobs, allRepresentationJobs, failedRepresentationJobs] = await Promise.all([
  prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrences" occurrence JOIN "phrases" phrase ON phrase."id" = occurrence."phraseId" AND phrase."status" = ${"normalized"} WHERE occurrence."sourceField" = ${"ai_expression"} AND (${targetUserId}::text IS NULL OR occurrence."userId" = ${targetUserId})`,
  prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrence_embeddings" embedding JOIN "phrase_occurrences" occurrence ON occurrence."id" = embedding."occurrenceId" WHERE embedding."modelVersion" = ${modelVersion} AND embedding."representationVersion" = ${backfillRepresentation} AND (${requiresPromptVersion}::boolean = false OR embedding."promptVersion" = ${promptVersion}) AND (${targetUserId}::text IS NULL OR occurrence."userId" = ${targetUserId})`,
  prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrences" occurrence JOIN "phrases" phrase ON phrase."id" = occurrence."phraseId" AND phrase."status" = ${"normalized"} WHERE occurrence."sourceField" = ${"ai_expression"} AND (${targetUserId}::text IS NULL OR occurrence."userId" = ${targetUserId}) AND (EXISTS (SELECT 1 FROM "phrase_occurrence_embeddings" embedding WHERE embedding."occurrenceId" = occurrence."id" AND embedding."modelVersion" = ${modelVersion} AND embedding."representationVersion" = ${backfillRepresentation} AND (${requiresPromptVersion}::boolean = false OR embedding."promptVersion" = ${promptVersion})) OR EXISTS (SELECT 1 FROM "card_enrichment_jobs" job WHERE job."userId" = occurrence."userId" AND job."sourceKind" = ${"phrase_occurrence"} AND job."sourceId" = occurrence."id" AND job."jobType" = ${"generate_phrase_occurrence_embedding"} AND job."status" = ${"completed"} AND left(job."inputVersion", ${backfillPrefix.length}::integer) = ${backfillPrefix}))`,
  prisma.cardEnrichmentJob.groupBy({ by: ["status"], where: { jobType: "generate_phrase_occurrence_embedding", inputVersion: { startsWith: backfillPrefix }, ...(targetUserId ? { userId: targetUserId } : {}) }, _count: { _all: true } }),
  prisma.cardEnrichmentJob.groupBy({ by: ["status"], where: { jobType: "generate_phrase_occurrence_embedding", inputVersion: { contains: senseInputMarker }, ...(targetUserId ? { userId: targetUserId } : {}) }, _count: { _all: true } }),
  prisma.cardEnrichmentJob.groupBy({ by: ["lastError"], where: { jobType: "generate_phrase_occurrence_embedding", inputVersion: { contains: senseInputMarker }, status: "failed", ...(targetUserId ? { userId: targetUserId } : {}) }, _count: { _all: true } }),
]);
const total = Number(eligible[0]?.count || 0);
const done = Number(embedded[0]?.count || 0);
const handledCount = Number(handled[0]?.count || 0);
console.log(`context_relations_enabled=${String(process.env.RELATED_PHRASE_CONTEXT_ENABLED || "false").toLowerCase() === "true"}`);
console.log(`context_relations_scope=${String(process.env.RELATED_PHRASE_CONTEXT_USER_ID || "").trim() ? "target_user" : "all_users"}`);
console.log(`context_representation=${relationRepresentation}`);
console.log(`backfill_enabled=${String(process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED || "false").toLowerCase() === "true"}`);
console.log(`backfill_scope=${targetUserId ? "target_user" : "all_users"}`);
console.log(`backfill_representation=${backfillRepresentation}`);
console.log(`backfill_batch=${process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_BATCH_SIZE || "5"}`);
console.log(`backfill_max_outstanding=${process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_MAX_OUTSTANDING || "10"}`);
console.log(`backfill_scan_interval_ms=${process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS || "60000"}`);
console.log(`eligible=${total}`);
console.log(`embedded=${done}`);
console.log(`skipped=${Math.max(0, handledCount - done)}`);
console.log(`missing=${Math.max(0, total - handledCount)}`);
for (const row of jobs) console.log(`jobs_${row.status}=${row._count._all}`);
for (const row of allRepresentationJobs) console.log(`representation_jobs_${row.status}=${row._count._all}`);
const failedCodes = new Map();
for (const row of failedRepresentationJobs) {
  const code = String(row.lastError || "UNKNOWN").match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] || "UNKNOWN";
  failedCodes.set(code, (failedCodes.get(code) || 0) + row._count._all);
}
for (const [code, count] of failedCodes) console.log(`representation_failed_${code}=${count}`);
await prisma.$disconnect();
NODE
    echo api_status=$(pm2 jlist | node -e '"'"'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(r).find(x=>x.name==="oio-api-production")?.pm2_env?.status||"missing"))'"'"')
    echo worker_status=$(pm2 jlist | node -e '"'"'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(r).find(x=>x.name==="oio-worker-production")?.pm2_env?.status||"missing"))'"'"')'
  exit 0
fi

case "$action" in
  --target-sense-backfill|--enable-target-sense-canary|--enable-target-context-v2-canary|--enable-target-context-v2-low|--enable-target-sense-relations)
    [[ $# -eq 3 && "${3:-}" == "--confirm-production" ]] || usage
    target_email="$2"
    mode="${action#--}"
    ;;
  --broad-context-v2-backfill|--throttle-all-low|--broad-backfill|--enable-all-relations|--stop-backfill|--disable)
    [[ $# -eq 2 && "${2:-}" == "--confirm-production" ]] || usage
    target_email=""
    mode="${action#--}"
    ;;
  *) usage ;;
esac

ssh oio-main "bash -s -- '$mode' '$target_email'" <<'REMOTE'
set -euo pipefail
mode="$1"
target_email="$2"
cd /opt/oio-production
test -f .env
backup=".env.backup-phrase-context-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p .env "$backup"

MODE="$mode" TARGET_EMAIL="$target_email" node --env-file=.env --import tsx <<'NODE'
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const mode = process.env.MODE;
let targetUserId = "";
if (mode === "target-sense-backfill" || mode === "enable-target-sense-canary" || mode === "enable-target-context-v2-canary" || mode === "enable-target-context-v2-low" || mode === "enable-target-sense-relations") {
  const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
  if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
  targetUserId = users[0].id;
}
if (mode === "enable-target-sense-canary") {
  const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
  const coverage = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
      FROM "phrase_occurrences" occurrence
      JOIN "phrase_occurrence_embeddings" embedding
        ON embedding."occurrenceId" = occurrence."id"
       AND embedding."modelVersion" = ${modelVersion}
       AND embedding."representationVersion" = ${"usage_meaning_v1"}
     WHERE occurrence."userId" = ${targetUserId}
       AND occurrence."sourceField" = ${"ai_expression"}
       AND occurrence."clozeBlankId" IS NOT NULL`;
  if (Number(coverage[0]?.count || 0) < 10) {
    throw new Error(`SENSE_CANARY_COVERAGE_INSUFFICIENT_${coverage[0]?.count || 0}`);
  }
}
if (mode === "enable-all-relations" || mode === "enable-target-sense-relations") {
  const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
  const representationVersion = "usage_meaning_v1";
  const promptVersion = "phrase_occurrence_sense_v1";
  const backfillPrefix = `phrase_occurrence_embedding_backfill_v2:${representationVersion}:${promptVersion}:${modelVersion}:`;
  const missing = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
      FROM "phrase_occurrences" occurrence
      JOIN "phrases" phrase ON phrase."id" = occurrence."phraseId" AND phrase."status" = ${"normalized"}
     WHERE occurrence."sourceField" = ${"ai_expression"}
       AND (${mode === "enable-target-sense-relations" ? targetUserId : null}::text IS NULL OR occurrence."userId" = ${mode === "enable-target-sense-relations" ? targetUserId : null})
       AND NOT EXISTS (
         SELECT 1 FROM "phrase_occurrence_embeddings" embedding
          WHERE embedding."occurrenceId" = occurrence."id"
            AND embedding."modelVersion" = ${modelVersion}
            AND embedding."representationVersion" = ${representationVersion}
       )
       AND NOT EXISTS (
         SELECT 1 FROM "card_enrichment_jobs" job
          WHERE job."userId" = occurrence."userId"
            AND job."sourceKind" = ${"phrase_occurrence"}
            AND job."sourceId" = occurrence."id"
            AND job."jobType" = ${"generate_phrase_occurrence_embedding"}
            AND job."status" = ${"completed"}
            AND left(job."inputVersion", ${backfillPrefix.length}::integer) = ${backfillPrefix}
       )`;
  if (Number(missing[0]?.count || 0) !== 0) throw new Error(`CONTEXT_BACKFILL_INCOMPLETE_${missing[0]?.count || 0}`);
}
await prisma.$disconnect();

const updates = new Map();
if (mode === "target-sense-backfill") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION", "usage_meaning_v1");
} else if (mode === "enable-target-sense-relations") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", targetUserId);
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v1");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "false");
} else if (mode === "enable-target-sense-canary") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", targetUserId);
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v1");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION", "usage_meaning_v1");
} else if (mode === "enable-target-context-v2-canary") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", targetUserId);
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v2");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION", "usage_meaning_v2");
} else if (mode === "enable-target-context-v2-low") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION", "usage_meaning_v2");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_BATCH_SIZE", "1");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "1");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "60000");
} else if (mode === "broad-context-v2-backfill") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", "");
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v2");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION", "usage_meaning_v2");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_BATCH_SIZE", "5");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "10");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "60000");
} else if (mode === "throttle-all-low") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_BATCH_SIZE", "2");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "4");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "60000");
} else if (mode === "broad-backfill") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_REPRESENTATION_VERSION", "usage_meaning_v1");
} else if (mode === "enable-all-relations") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", "");
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v1");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "false");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
} else if (mode === "stop-backfill") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "false");
} else if (mode === "disable") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "false");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", "");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "false");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
}
if (mode === "enable-target-sense-canary" || mode === "enable-target-context-v2-canary" || mode === "enable-target-sense-relations" || mode === "enable-all-relations") {
  updates.set("RELATED_PHRASE_SENSE_MIN_SIMILARITY", "0.45");
  updates.set("RELATED_PHRASE_SENSE_WEIGHT", "0.70");
}
if (mode !== "throttle-all-low" && mode !== "enable-target-context-v2-low") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_BATCH_SIZE", "5");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "10");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "60000");
}
const path = ".env";
const original = fs.readFileSync(path, "utf8");
const kept = original.split(/\r?\n/u).filter((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=/u);
  return !match || !updates.has(match[1]);
});
while (kept.length && kept.at(-1) === "") kept.pop();
const next = `${kept.join("\n")}\n${[...updates].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
const temp = `${path}.phrase-context-${process.pid}.tmp`;
fs.writeFileSync(temp, next, { mode: fs.statSync(path).mode });
fs.renameSync(temp, path);
NODE

if [[ "$mode" == "broad-backfill" || "$mode" == "target-sense-backfill" || "$mode" == "enable-target-context-v2-low" || "$mode" == "throttle-all-low" || "$mode" == "stop-backfill" ]]; then
  pm2 restart ecosystem.production.config.cjs --only oio-worker-production --update-env >/dev/null
else
  pm2 restart ecosystem.production.config.cjs --only oio-api-production,oio-worker-production --update-env >/dev/null
fi
sleep 2
test "$(pm2 pid oio-worker-production)" != "0"
test "$(pm2 pid oio-api-production)" != "0"
echo "mode=$mode"
echo "backup=$backup"
echo "health=online"
REMOTE

"$0" --status
