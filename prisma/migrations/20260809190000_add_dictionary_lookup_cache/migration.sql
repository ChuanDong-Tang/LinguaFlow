CREATE TABLE "dictionary_lookup_caches" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "contextHash" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "uiLanguage" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dictionary_lookup_caches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dictionary_lookup_caches_cacheKey_key" ON "dictionary_lookup_caches"("cacheKey");
CREATE INDEX "dictionary_lookup_caches_expiresAt_idx" ON "dictionary_lookup_caches"("expiresAt");
CREATE INDEX "dictionary_lookup_caches_userId_updatedAt_idx" ON "dictionary_lookup_caches"("userId", "updatedAt");
CREATE INDEX "dictionary_lookup_caches_targetLanguage_uiLanguage_updatedAt_idx" ON "dictionary_lookup_caches"("targetLanguage", "uiLanguage", "updatedAt");
ALTER TABLE "dictionary_lookup_caches" ADD CONSTRAINT "dictionary_lookup_caches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
