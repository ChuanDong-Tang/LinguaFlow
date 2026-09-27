#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --status | --target-email <email> --confirm-production | --broad-backfill --confirm-production | --enable-all-relations --confirm-production | --disable --confirm-production" >&2
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
const [eligible, embedded, jobs] = await Promise.all([
  prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrences" occurrence JOIN "phrases" phrase ON phrase."id" = occurrence."phraseId" AND phrase."status" = ${"normalized"} JOIN "card_rewrite_segments" segment ON segment."id" = occurrence."segmentId" AND segment."entryId" = occurrence."cardId" WHERE occurrence."sourceField" = ${"ai_expression"} AND (${targetUserId}::text IS NULL OR occurrence."userId" = ${targetUserId})`,
  prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrence_embeddings" embedding JOIN "phrase_occurrences" occurrence ON occurrence."id" = embedding."occurrenceId" WHERE embedding."modelVersion" = ${modelVersion} AND (${targetUserId}::text IS NULL OR occurrence."userId" = ${targetUserId})`,
  prisma.cardEnrichmentJob.groupBy({ by: ["status"], where: { jobType: "generate_phrase_occurrence_embedding", ...(targetUserId ? { userId: targetUserId } : {}) }, _count: { _all: true } }),
]);
const total = Number(eligible[0]?.count || 0);
const done = Number(embedded[0]?.count || 0);
console.log(`context_relations_enabled=${String(process.env.RELATED_PHRASE_CONTEXT_ENABLED || "false").toLowerCase() === "true"}`);
console.log(`context_relations_scope=${String(process.env.RELATED_PHRASE_CONTEXT_USER_ID || "").trim() ? "target_user" : "all_users"}`);
console.log(`backfill_enabled=${String(process.env.CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED || "false").toLowerCase() === "true"}`);
console.log(`backfill_scope=${targetUserId ? "target_user" : "all_users"}`);
console.log(`eligible=${total}`);
console.log(`embedded=${done}`);
console.log(`missing=${Math.max(0, total - done)}`);
for (const row of jobs) console.log(`jobs_${row.status}=${row._count._all}`);
await prisma.$disconnect();
NODE
    echo api_status=$(pm2 jlist | node -e '"'"'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(r).find(x=>x.name==="oio-api-production")?.pm2_env?.status||"missing"))'"'"')
    echo worker_status=$(pm2 jlist | node -e '"'"'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(r).find(x=>x.name==="oio-worker-production")?.pm2_env?.status||"missing"))'"'"')'
  exit 0
fi

case "$action" in
  --target-email)
    [[ $# -eq 3 && "${3:-}" == "--confirm-production" ]] || usage
    target_email="$2"
    mode="target"
    ;;
  --broad-backfill|--enable-all-relations|--disable)
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
if (mode === "target") {
  const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
  if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
  targetUserId = users[0].id;
}
if (mode === "enable-all-relations") {
  const modelVersion = `${process.env.AZURE_EMBEDDING_MODEL || "text-embedding-3-small"}:${process.env.AZURE_EMBEDDING_DEPLOYMENT}:${process.env.AZURE_EMBEDDING_API_VERSION || "2024-10-21"}:${process.env.AZURE_EMBEDDING_DIMENSIONS || "1536"}`;
  const missing = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
      FROM "phrase_occurrences" occurrence
      JOIN "phrases" phrase ON phrase."id" = occurrence."phraseId" AND phrase."status" = ${"normalized"}
      JOIN "card_rewrite_segments" segment ON segment."id" = occurrence."segmentId" AND segment."entryId" = occurrence."cardId"
     WHERE occurrence."sourceField" = ${"ai_expression"}
       AND NOT EXISTS (
         SELECT 1 FROM "phrase_occurrence_embeddings" embedding
          WHERE embedding."occurrenceId" = occurrence."id" AND embedding."modelVersion" = ${modelVersion}
       )`;
  if (Number(missing[0]?.count || 0) !== 0) throw new Error(`CONTEXT_BACKFILL_INCOMPLETE_${missing[0]?.count || 0}`);
}
await prisma.$disconnect();

const updates = new Map();
if (mode === "target") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", targetUserId);
} else if (mode === "broad-backfill") {
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
} else if (mode === "enable-all-relations") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "true");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", "");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "false");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
} else if (mode === "disable") {
  updates.set("RELATED_PHRASE_CONTEXT_ENABLED", "false");
  updates.set("RELATED_PHRASE_CONTEXT_USER_ID", "");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_ENABLED", "false");
  updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_USER_ID", "");
}
updates.set("RELATED_PHRASE_CONTEXT_MIN_SIMILARITY", "0.78");
updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_BATCH_SIZE", "5");
updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_MAX_OUTSTANDING", "10");
updates.set("CARD_PHRASE_OCCURRENCE_EMBEDDING_BACKFILL_SCAN_INTERVAL_MS", "60000");
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

if [[ "$mode" == "broad-backfill" ]]; then
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
