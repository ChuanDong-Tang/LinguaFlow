#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --status <email> | --pause <email> --minutes <1-1440> --confirm-production | --resume <email> --confirm-production | --probe-one <email> --confirm-production" >&2
  exit 2
}

action="${1:-}"
email="${2:-}"
[[ -n "$email" ]] || usage

case "$action" in
  --status)
    [[ $# -eq 2 ]] || usage
    minutes="0"
    confirm=""
    ;;
  --pause)
    [[ $# -eq 5 && "${3:-}" == "--minutes" && "${5:-}" == "--confirm-production" ]] || usage
    minutes="${4:-}"
    [[ "$minutes" =~ ^[0-9]+$ && "$minutes" -ge 1 && "$minutes" -le 1440 ]] || usage
    confirm="true"
    ;;
  --resume)
    [[ $# -eq 3 && "${3:-}" == "--confirm-production" ]] || usage
    minutes="0"
    confirm="true"
    ;;
  --probe-one)
    [[ $# -eq 3 && "${3:-}" == "--confirm-production" ]] || usage
    minutes="60"
    confirm="true"
    ;;
  *) usage ;;
esac

ssh oio-main "bash -s -- '$action' '$email' '$minutes' '$confirm'" <<'REMOTE'
set -euo pipefail
action="$1"
email="$2"
minutes="$3"
confirm="$4"
cd /opt/oio-production

ACTION="$action" TARGET_EMAIL="$email" PAUSE_MINUTES="$minutes" CONFIRM_PRODUCTION="$confirm" node --env-file=.env --import tsx <<'NODE'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const promptVersion = "phrase_relation_judge_v3";
try {
  const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
  if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
  const userId = users[0].id;
  const where = {
    userId,
    jobType: "judge_phrase_relation",
    inputVersion: { startsWith: `${promptVersion}:` },
    status: "queued",
  };
  const before = await prisma.cardEnrichmentJob.count({ where });
  let changed = 0;
  if (process.env.ACTION === "--pause") {
    if (process.env.CONFIRM_PRODUCTION !== "true") throw new Error("CONFIRM_PRODUCTION_REQUIRED");
    const availableAt = new Date(Date.now() + Number(process.env.PAUSE_MINUTES) * 60_000);
    changed = (await prisma.cardEnrichmentJob.updateMany({ where, data: { availableAt } })).count;
  } else if (process.env.ACTION === "--resume") {
    if (process.env.CONFIRM_PRODUCTION !== "true") throw new Error("CONFIRM_PRODUCTION_REQUIRED");
    changed = (await prisma.cardEnrichmentJob.updateMany({ where, data: { availableAt: new Date() } })).count;
  } else if (process.env.ACTION === "--probe-one") {
    if (process.env.CONFIRM_PRODUCTION !== "true") throw new Error("CONFIRM_PRODUCTION_REQUIRED");
    const jobs = await prisma.cardEnrichmentJob.findMany({ where, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }], select: { id: true } });
    if (jobs.length) {
      const pauseUntil = new Date(Date.now() + 60 * 60_000);
      await prisma.cardEnrichmentJob.updateMany({ where, data: { availableAt: pauseUntil } });
      changed = (await prisma.cardEnrichmentJob.updateMany({ where: { id: jobs[0].id, status: "queued" }, data: { availableAt: new Date() } })).count;
    }
  }
  const after = await prisma.cardEnrichmentJob.aggregate({
    where,
    _count: { _all: true },
    _min: { availableAt: true },
    _max: { availableAt: true },
  });
  console.log(`action=${process.env.ACTION}`);
  console.log(`prompt_version=${promptVersion}`);
  console.log(`queued_before=${before}`);
  console.log(`changed=${changed}`);
  console.log(`queued_after=${after._count._all}`);
  console.log(`min_available_at=${after._min.availableAt?.toISOString() ?? "none"}`);
  console.log(`max_available_at=${after._max.availableAt?.toISOString() ?? "none"}`);
} finally {
  await prisma.$disconnect();
}
NODE
REMOTE
