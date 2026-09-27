CREATE TABLE "phrase_occurrence_relation_decisions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "anchorOccurrenceId" TEXT NOT NULL,
  "selectedOccurrenceId" TEXT,
  "promptVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "candidateOccurrenceIds" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "selectedSemanticScore" DOUBLE PRECISION,
  "provider" TEXT,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "phrase_occurrence_relation_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phrase_occurrence_relation_decisions_anchorOccurrenceId_promptVersion_key"
  ON "phrase_occurrence_relation_decisions"("anchorOccurrenceId", "promptVersion");
CREATE INDEX "phrase_occurrence_relation_decisions_userId_promptVersion_status_idx"
  ON "phrase_occurrence_relation_decisions"("userId", "promptVersion", "status");
CREATE INDEX "phrase_occurrence_relation_decisions_selectedOccurrenceId_idx"
  ON "phrase_occurrence_relation_decisions"("selectedOccurrenceId");

ALTER TABLE "phrase_occurrence_relation_decisions"
  ADD CONSTRAINT "phrase_occurrence_relation_decisions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_occurrence_relation_decisions"
  ADD CONSTRAINT "phrase_occurrence_relation_decisions_anchorOccurrenceId_fkey"
  FOREIGN KEY ("anchorOccurrenceId") REFERENCES "phrase_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_occurrence_relation_decisions"
  ADD CONSTRAINT "phrase_occurrence_relation_decisions_selectedOccurrenceId_fkey"
  FOREIGN KEY ("selectedOccurrenceId") REFERENCES "phrase_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
