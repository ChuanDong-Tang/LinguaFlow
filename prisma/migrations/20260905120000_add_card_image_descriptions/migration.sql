ALTER TABLE "card_image_assets"
ADD COLUMN "descriptionText" TEXT,
ADD COLUMN "descriptionLanguageCode" TEXT,
ADD COLUMN "descriptionSourceHash" TEXT,
ADD COLUMN "descriptionPromptVersion" TEXT,
ADD COLUMN "descriptionResultVersion" TEXT,
ADD COLUMN "descriptionAuxiliarySegments" JSONB,
ADD COLUMN "descriptionAuxiliaryLanguageCode" TEXT,
ADD COLUMN "descriptionAuxiliaryPromptVersion" TEXT,
ADD COLUMN "descriptionStatus" TEXT NOT NULL DEFAULT 'not_requested',
ADD COLUMN "descriptionError" TEXT,
ADD COLUMN "descriptionUpdatedAt" TIMESTAMP(3);

ALTER TABLE "card_enrichment_jobs"
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "card_enrichment_jobs_status_availableAt_leaseExpiresAt_createdAt_idx";
CREATE INDEX "card_enrichment_jobs_claim_idx"
ON "card_enrichment_jobs"("jobType", "status", "priority", "availableAt", "leaseExpiresAt", "createdAt");

CREATE TABLE "ai_usage_events" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT,
  "billingMode" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "imageCount" INTEGER NOT NULL DEFAULT 0,
  "meteringSource" TEXT NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "metadata" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_events_tokens_nonnegative" CHECK (
    "inputTokens" >= 0 AND "outputTokens" >= 0 AND "totalTokens" >= 0 AND "imageCount" >= 0
  )
);

CREATE UNIQUE INDEX "ai_usage_events_requestId_key" ON "ai_usage_events"("requestId");
CREATE INDEX "ai_usage_events_operation_status_createdAt_idx" ON "ai_usage_events"("operation", "status", "createdAt");
CREATE INDEX "ai_usage_events_userId_createdAt_idx" ON "ai_usage_events"("userId", "createdAt");

ALTER TABLE "ai_usage_events"
ADD CONSTRAINT "ai_usage_events_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
