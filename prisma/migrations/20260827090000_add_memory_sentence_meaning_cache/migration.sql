CREATE TABLE "memory_sentence_meaning_caches" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "sentenceHash" TEXT NOT NULL,
  "sourceLanguage" TEXT NOT NULL,
  "nativeLanguage" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "meaning" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "memory_sentence_meaning_caches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memory_sentence_meaning_caches_cacheKey_key" ON "memory_sentence_meaning_caches"("cacheKey");
CREATE INDEX "memory_sentence_meaning_caches_userId_updatedAt_idx" ON "memory_sentence_meaning_caches"("userId", "updatedAt");
CREATE INDEX "memory_sentence_meaning_caches_sourceLanguage_nativeLanguage_updatedAt_idx" ON "memory_sentence_meaning_caches"("sourceLanguage", "nativeLanguage", "updatedAt");
ALTER TABLE "memory_sentence_meaning_caches" ADD CONSTRAINT "memory_sentence_meaning_caches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
