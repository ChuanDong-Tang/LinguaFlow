#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--email" || -z "${2:-}" || "${3:-}" != "--canonical-csv" || -z "${4:-}" || "${5:-}" != "--confirm-production" || $# -ne 5 ]]; then
  echo "Usage: $0 --email <email> --canonical-csv <comma-separated-canonical-phrases> --confirm-production" >&2
  exit 2
fi

email="$2"
canonical_csv="$4"

ssh oio-main "bash -s -- '$email' '$canonical_csv'" <<'REMOTE'
set -euo pipefail
email="$1"
canonical_csv="$2"
cd /opt/oio-production
TARGET_EMAIL="$email" CANONICAL_CSV="$canonical_csv" node --env-file=.env --import tsx <<'NODE'
import { PrismaClient } from "@prisma/client";
import { enqueuePhraseOccurrenceEmbeddingForOccurrence } from "./server/src/infrastructure/repository/PhraseOccurrenceEmbeddingJobs.ts";

const prisma = new PrismaClient();
const phrases = String(process.env.CANONICAL_CSV || "").split(",").map((value) => value.trim()).filter(Boolean);
if (!phrases.length || phrases.length > 10) throw new Error("CANARY_PHRASE_COUNT_INVALID");
const users = await prisma.user.findMany({ where: { email: process.env.TARGET_EMAIL }, select: { id: true }, take: 2 });
if (users.length !== 1) throw new Error(`TARGET_USER_CARDINALITY_${users.length}`);
const userId = users[0].id;
const occurrences = await prisma.phraseOccurrence.findMany({
  where: {
    userId,
    sourceField: "ai_expression",
    phrase: { status: "normalized", canonicalText: { in: phrases, mode: "insensitive" } },
  },
  select: { id: true },
  orderBy: [{ cardCreatedAt: "desc" }, { id: "desc" }],
  take: 20,
});
if (!occurrences.length) throw new Error("CANARY_OCCURRENCES_NOT_FOUND");
await prisma.$transaction(async (tx) => {
  for (const occurrence of occurrences) await enqueuePhraseOccurrenceEmbeddingForOccurrence(tx, occurrence.id);
});
console.log(`matched_occurrences=${occurrences.length}`);
console.log("enqueued_scope=target_user_known_phrases");
await prisma.$disconnect();
NODE
REMOTE
