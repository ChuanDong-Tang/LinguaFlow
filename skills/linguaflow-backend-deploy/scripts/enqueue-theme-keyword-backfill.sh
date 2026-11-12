#!/usr/bin/env bash
set -euo pipefail

# One-shot, bounded backfill of the 相关回忆 theme keyword for cards made
# before topic prompt v4. Only queues `generate_theme_keyword` jobs; the
# Worker fills cards.themeKeyword (topic / headline untouched). Platform-owned,
# never billed to users. Not a scanner: run it explicitly, small batch first.
#
#   enqueue-theme-keyword-backfill.sh --count 20 --email <user> --confirm-production   # canary
#   enqueue-theme-keyword-backfill.sh --count 2000 --confirm-production                 # everyone

usage() {
  echo "Usage: $0 --count <1-5000> [--email <email>] --confirm-production" >&2
  exit 2
}

count=""; email=""; confirmed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) count="${2:-}"; shift 2 ;;
    --email) email="${2:-}"; shift 2 ;;
    --confirm-production) confirmed=true; shift ;;
    *) usage ;;
  esac
done
[[ "$confirmed" == true && "$count" =~ ^[0-9]+$ ]] || usage
(( count >= 1 && count <= 5000 )) || usage

ssh oio-main "set -euo pipefail
  cd /opt/oio-production
  TARGET_EMAIL='$email' COUNT='$count' node --env-file=.env --import tsx" <<'NODE'
import { PrismaClient } from "@prisma/client";
import { CARD_THEME_KEYWORD_PROMPT_VERSION } from "@lf/core/Prompts/cardThemeKeywordPrompt.js";
import { PrismaCardEnrichmentRepository } from "./server/src/infrastructure/repository/PrismaCardEnrichmentRepository.ts";

const prisma = new PrismaClient();
try {
  let userId;
  if (process.env.TARGET_EMAIL) {
    const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
    if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
    userId = users[0].id;
  }
  const missingBefore = await prisma.card.count({ where: { ...(userId ? { userId } : {}), status: "completed", deletedAt: null, isSample: false, themeKeyword: null, originalText: { not: null } } });
  const repository = new PrismaCardEnrichmentRepository(prisma);
  const enqueued = await repository.enqueueThemeKeywordBackfill({ limit: Number(process.env.COUNT), userId, inputVersion: CARD_THEME_KEYWORD_PROMPT_VERSION });
  const queued = await prisma.cardEnrichmentJob.count({ where: { jobType: "generate_theme_keyword", status: { in: ["queued", "processing"] } } });
  console.log(JSON.stringify({ scope: userId ? "one_user" : "all_users", missingBefore, enqueued, queued }));
} finally {
  await prisma.$disconnect();
}
NODE
