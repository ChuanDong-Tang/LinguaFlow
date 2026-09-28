#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 0 ]] || { echo "Usage: $0" >&2; exit 2; }

ssh oio-main "set -euo pipefail
  cd /opt/oio-production
  node --env-file=.env --import tsx" <<'NODE'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const grouped = await prisma.cardEnrichmentJob.groupBy({
    by: ["status"],
    where: {
      jobType: "generate_phrase_occurrence_embedding",
      inputVersion: { startsWith: "phrase_occurrence_embedding_backfill_v2:usage_meaning_v2:" },
    },
    _count: { _all: true },
  });
  for (const status of ["queued", "processing", "completed", "failed"]) {
    console.log(`${status}=${grouped.find((row) => row.status === status)?._count._all ?? 0}`);
  }
  const allBackfillOutstanding = await prisma.cardEnrichmentJob.count({
    where: {
      jobType: "generate_phrase_occurrence_embedding",
      inputVersion: { startsWith: "phrase_occurrence_embedding_backfill_v2:" },
      status: { in: ["queued", "processing"] },
    },
  });
  const realtimeOutstanding = await prisma.cardEnrichmentJob.count({
    where: {
      jobType: "generate_phrase_occurrence_embedding",
      NOT: { inputVersion: { startsWith: "phrase_occurrence_embedding_backfill_v2:" } },
      status: { in: ["queued", "processing"] },
    },
  });
  console.log(`all_backfill_outstanding=${allBackfillOutstanding}`);
  console.log(`realtime_outstanding=${realtimeOutstanding}`);
  const outstanding = await prisma.cardEnrichmentJob.aggregate({
    where: {
      jobType: "generate_phrase_occurrence_embedding",
      inputVersion: { startsWith: "phrase_occurrence_embedding_backfill_v2:usage_meaning_v2:" },
      status: { in: ["queued", "processing"] },
    },
    _min: { availableAt: true, attempts: true, processingAt: true, leaseExpiresAt: true },
    _max: { availableAt: true, attempts: true, processingAt: true, leaseExpiresAt: true },
  });
  console.log(`outstanding_min_available_at=${outstanding._min.availableAt?.toISOString() ?? "none"}`);
  console.log(`outstanding_max_available_at=${outstanding._max.availableAt?.toISOString() ?? "none"}`);
  console.log(`outstanding_attempts_min=${outstanding._min.attempts ?? 0}`);
  console.log(`outstanding_attempts_max=${outstanding._max.attempts ?? 0}`);
  console.log(`outstanding_min_lease_expires_at=${outstanding._min.leaseExpiresAt?.toISOString() ?? "none"}`);
  console.log(`outstanding_max_lease_expires_at=${outstanding._max.leaseExpiresAt?.toISOString() ?? "none"}`);
  for (const minutes of [1, 5, 15]) {
    const recent = await prisma.systemEventLog.groupBy({
      by: ["event", "errorCode"],
      where: {
        module: "card",
        event: { in: ["phrase.occurrence_embedding.retry", "phrase.occurrence_embedding.failed"] },
        createdAt: { gte: new Date(Date.now() - minutes * 60_000) },
      },
      _count: { _all: true },
    });
    for (const row of recent) {
      console.log(`recent_${minutes}m_${row.event}_${row.errorCode ?? "none"}=${row._count._all}`);
    }
  }
  const retryRequests = await prisma.systemEventLog.groupBy({
    by: ["requestId"],
    where: {
      event: "phrase.occurrence_embedding.retry",
      errorCode: "RESOURCE_LIMITED",
      createdAt: { gte: new Date(Date.now() - 60_000) },
    },
    _count: { _all: true },
  });
  console.log(`limited_1m_distinct_requests=${retryRequests.length}`);
  console.log(`limited_1m_max_events_per_request=${Math.max(0, ...retryRequests.map((row) => row._count._all))}`);
  const latest = await prisma.systemEventLog.findFirst({
    where: { module: "card", event: { in: ["phrase.occurrence_embedding.retry", "phrase.occurrence_embedding.failed"] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, event: true, errorCode: true },
  });
  console.log(`latest_event_at=${latest?.createdAt.toISOString() ?? "none"}`);
  console.log(`latest_event=${latest?.event ?? "none"}`);
  console.log(`latest_error_code=${latest?.errorCode ?? "none"}`);
} finally {
  await prisma.$disconnect();
}
NODE
