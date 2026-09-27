ALTER TABLE "phrase_occurrence_embeddings"
ADD COLUMN "representationVersion" TEXT NOT NULL DEFAULT 'marked_sentence_v1',
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "meaningText" TEXT;

DROP INDEX "phrase_occurrence_embeddings_occurrenceId_modelVersion_key";
DROP INDEX "phrase_occurrence_embeddings_userId_modelVersion_idx";
DROP INDEX "phrase_occurrence_embeddings_userId_cardId_modelVersion_idx";

CREATE UNIQUE INDEX "phrase_occurrence_embeddings_occurrenceId_modelVersion_representationVersion_key"
ON "phrase_occurrence_embeddings"("occurrenceId", "modelVersion", "representationVersion");

CREATE INDEX "phrase_occurrence_embeddings_userId_modelVersion_representationVersion_idx"
ON "phrase_occurrence_embeddings"("userId", "modelVersion", "representationVersion");

CREATE INDEX "phrase_occurrence_embeddings_userId_cardId_modelVersion_representationVersion_idx"
ON "phrase_occurrence_embeddings"("userId", "cardId", "modelVersion", "representationVersion");
