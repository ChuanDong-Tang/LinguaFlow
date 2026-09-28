#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --status | --enable-target-high <email> --confirm-production | --enable-target-low <email> --confirm-production | --enable-all-slow --confirm-production | --throttle-all-low --confirm-production | --stop-backfill --confirm-production | --disable --confirm-production" >&2
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
const targetUserId = String(process.env.CARD_PHRASE_RELATION_JUDGE_BACKFILL_USER_ID || process.env.RELATED_PHRASE_JUDGE_USER_ID || "").trim() || null;
const promptVersion = "phrase_relation_judge_v2";
const [eligible, decisions, jobs, failures] = await Promise.all([
  prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrences" occurrence JOIN "phrase_occurrence_embeddings" embedding ON embedding."occurrenceId" = occurrence."id" AND embedding."representationVersion" = ${"usage_meaning_v2"} WHERE (${targetUserId}::text IS NULL OR occurrence."userId" = ${targetUserId}) AND occurrence."sourceField" = ${"ai_expression"} AND occurrence."clozeBlankId" IS NOT NULL`,
  prisma.phraseOccurrenceRelationDecision.groupBy({ by: ["status"], where: { ...(targetUserId ? { userId: targetUserId } : {}), promptVersion }, _count: { _all: true } }),
  prisma.cardEnrichmentJob.groupBy({ by: ["status"], where: { ...(targetUserId ? { userId: targetUserId } : {}), jobType: "judge_phrase_relation", inputVersion: { startsWith: `${promptVersion}:` } }, _count: { _all: true } }),
  prisma.cardEnrichmentJob.groupBy({ by: ["lastError"], where: { ...(targetUserId ? { userId: targetUserId } : {}), jobType: "judge_phrase_relation", status: "failed", inputVersion: { startsWith: `${promptVersion}:` } }, _count: { _all: true } }),
]);
const eligibleCount = Number(eligible[0]?.count || 0);
const decidedCount = decisions.reduce((sum, row) => sum + row._count._all, 0);
console.log(`judge_api_enabled=${String(process.env.RELATED_PHRASE_JUDGE_ENABLED || "false").toLowerCase() === "true"}`);
console.log(`judge_scope=${String(process.env.RELATED_PHRASE_JUDGE_ENABLED || "false").toLowerCase() !== "true" ? "disabled" : String(process.env.RELATED_PHRASE_JUDGE_USER_ID || "").trim() ? "target_user" : "all_users"}`);
console.log(`judge_backfill_enabled=${String(process.env.CARD_PHRASE_RELATION_JUDGE_BACKFILL_ENABLED || "false").toLowerCase() === "true"}`);
console.log(`judge_backfill_scope=${targetUserId ? "target_user" : "all_users"}`);
console.log(`judge_batch=${process.env.CARD_PHRASE_RELATION_JUDGE_BACKFILL_BATCH_SIZE || "5"}`);
console.log(`judge_max_outstanding=${process.env.CARD_PHRASE_RELATION_JUDGE_BACKFILL_MAX_OUTSTANDING || "10"}`);
console.log(`judge_scan_interval_ms=${process.env.CARD_PHRASE_RELATION_JUDGE_BACKFILL_SCAN_INTERVAL_MS || "60000"}`);
console.log(`eligible=${eligibleCount}`);
for (const row of decisions) console.log(`decisions_${row.status}=${row._count._all}`);
console.log(`decisions_total=${decidedCount}`);
console.log(`missing=${Math.max(0, eligibleCount - decidedCount)}`);
for (const row of jobs) console.log(`jobs_${row.status}=${row._count._all}`);
for (const row of failures) {
  const code = String(row.lastError || "UNKNOWN").match(/[A-Z][A-Z0-9_]{3,}/u)?.[0] || "UNKNOWN";
  console.log(`failed_${code}=${row._count._all}`);
}
await prisma.$disconnect();
NODE
    echo api_status=$(pm2 jlist | node -e '"'"'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(r).find(x=>x.name==="oio-api-production")?.pm2_env?.status||"missing"))'"'"')
    echo worker_status=$(pm2 jlist | node -e '"'"'let r="";process.stdin.on("data",c=>r+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(r).find(x=>x.name==="oio-worker-production")?.pm2_env?.status||"missing"))'"'"')'
  exit 0
fi

case "$action" in
  --enable-target-high|--enable-target-low)
    [[ $# -eq 3 && "${3:-}" == "--confirm-production" ]] || usage
    mode="${action#--}"
    target_email="$2"
    ;;
  --enable-all-slow|--throttle-all-low|--stop-backfill|--disable)
    [[ $# -eq 2 && "${2:-}" == "--confirm-production" ]] || usage
    mode="${action#--}"
    target_email=""
    ;;
  *) usage ;;
esac

ssh oio-main "bash -s -- '$mode' '$target_email'" <<'REMOTE'
set -euo pipefail
mode="$1"
target_email="$2"
cd /opt/oio-production
test -f .env
backup=".env.backup-phrase-relation-judge-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p .env "$backup"

MODE="$mode" TARGET_EMAIL="$target_email" node --env-file=.env --import tsx <<'NODE'
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const mode = process.env.MODE;
let targetUserId = "";
if (mode === "enable-target-high" || mode === "enable-target-low") {
  const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
  if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
  targetUserId = users[0].id;
  const v2Coverage = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "phrase_occurrences" occurrence JOIN "phrase_occurrence_embeddings" embedding ON embedding."occurrenceId" = occurrence."id" AND embedding."representationVersion" = ${"usage_meaning_v2"} WHERE occurrence."userId" = ${targetUserId} AND occurrence."sourceField" = ${"ai_expression"} AND occurrence."clozeBlankId" IS NOT NULL`;
  if (Number(v2Coverage[0]?.count || 0) < 10) throw new Error(`V2_COVERAGE_INSUFFICIENT_${v2Coverage[0]?.count || 0}`);
}
await prisma.$disconnect();

const updates = new Map();
if (mode === "enable-target-high") {
  updates.set("RELATED_PHRASE_JUDGE_ENABLED", "true");
  updates.set("RELATED_PHRASE_JUDGE_USER_ID", targetUserId);
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v2");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_BATCH_SIZE", "20");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_MAX_OUTSTANDING", "40");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_SCAN_INTERVAL_MS", "15000");
} else if (mode === "enable-target-low") {
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_USER_ID", targetUserId);
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_BATCH_SIZE", "1");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_MAX_OUTSTANDING", "1");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_SCAN_INTERVAL_MS", "60000");
} else if (mode === "enable-all-slow") {
  updates.set("RELATED_PHRASE_JUDGE_ENABLED", "true");
  updates.set("RELATED_PHRASE_JUDGE_USER_ID", "");
  updates.set("RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION", "usage_meaning_v2");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_ENABLED", "true");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_USER_ID", "");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_BATCH_SIZE", "5");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_MAX_OUTSTANDING", "10");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_SCAN_INTERVAL_MS", "60000");
} else if (mode === "throttle-all-low") {
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_BATCH_SIZE", "2");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_MAX_OUTSTANDING", "4");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_SCAN_INTERVAL_MS", "60000");
} else if (mode === "stop-backfill") {
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_ENABLED", "false");
} else if (mode === "disable") {
  updates.set("RELATED_PHRASE_JUDGE_ENABLED", "false");
  updates.set("RELATED_PHRASE_JUDGE_USER_ID", "");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_ENABLED", "false");
  updates.set("CARD_PHRASE_RELATION_JUDGE_BACKFILL_USER_ID", "");
}
const path = ".env";
const original = fs.readFileSync(path, "utf8");
const kept = original.split(/\r?\n/u).filter((line) => {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=/u);
  return !match || !updates.has(match[1]);
});
while (kept.length && kept.at(-1) === "") kept.pop();
const next = `${kept.join("\n")}\n${[...updates].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
const temp = `${path}.phrase-relation-judge-${process.pid}.tmp`;
fs.writeFileSync(temp, next, { mode: fs.statSync(path).mode });
fs.renameSync(temp, path);
NODE

if [[ "$mode" == "throttle-all-low" || "$mode" == "stop-backfill" ]]; then
  pm2 restart ecosystem.production.config.cjs --only oio-worker-production --update-env >/dev/null
else
  pm2 restart ecosystem.production.config.cjs --only oio-api-production,oio-worker-production --update-env >/dev/null
fi
sleep 2
test "$(pm2 pid oio-api-production)" != "0"
test "$(pm2 pid oio-worker-production)" != "0"
echo "mode=$mode"
echo "backup=$backup"
echo "health=online"
REMOTE

"$0" --status
