CREATE TABLE "phrase_embeddings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phraseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phrase_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phrase_embeddings_phraseId_modelVersion_key"
ON "phrase_embeddings"("phraseId", "modelVersion");

CREATE INDEX "phrase_embeddings_userId_modelVersion_idx"
ON "phrase_embeddings"("userId", "modelVersion");

ALTER TABLE "phrase_embeddings"
ADD CONSTRAINT "phrase_embeddings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "phrase_embeddings"
ADD CONSTRAINT "phrase_embeddings_phraseId_fkey"
FOREIGN KEY ("phraseId") REFERENCES "phrases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
