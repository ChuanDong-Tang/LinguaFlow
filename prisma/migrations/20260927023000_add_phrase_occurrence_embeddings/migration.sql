CREATE TABLE "phrase_occurrence_embeddings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phrase_occurrence_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phrase_occurrence_embeddings_occurrenceId_modelVersion_key"
ON "phrase_occurrence_embeddings"("occurrenceId", "modelVersion");

CREATE INDEX "phrase_occurrence_embeddings_userId_modelVersion_idx"
ON "phrase_occurrence_embeddings"("userId", "modelVersion");

CREATE INDEX "phrase_occurrence_embeddings_userId_cardId_modelVersion_idx"
ON "phrase_occurrence_embeddings"("userId", "cardId", "modelVersion");

ALTER TABLE "phrase_occurrence_embeddings"
ADD CONSTRAINT "phrase_occurrence_embeddings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "phrase_occurrence_embeddings"
ADD CONSTRAINT "phrase_occurrence_embeddings_cardId_fkey"
FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "phrase_occurrence_embeddings"
ADD CONSTRAINT "phrase_occurrence_embeddings_occurrenceId_fkey"
FOREIGN KEY ("occurrenceId") REFERENCES "phrase_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
