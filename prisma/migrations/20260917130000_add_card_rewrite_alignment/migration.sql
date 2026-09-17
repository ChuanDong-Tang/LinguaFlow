ALTER TABLE "cards"
ADD COLUMN "rewriteAlignment" JSONB;

UPDATE "card_enrichment_jobs"
   SET "status" = 'cancelled',
       "lastError" = 'Replaced by rewrite alignment',
       "completedAt" = NOW(),
       "failedAt" = NULL,
       "leaseExpiresAt" = NULL,
       "workerId" = NULL
 WHERE "jobType" = 'generate_auxiliary'
   AND "status" IN ('queued', 'processing');
