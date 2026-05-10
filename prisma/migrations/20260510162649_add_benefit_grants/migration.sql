CREATE TYPE "BenefitGrantStatus" AS ENUM ('pending', 'processing', 'success', 'failed');

CREATE TABLE "benefit_grants" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "BenefitGrantStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMsg" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "benefit_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "benefit_grants_sourceOrderId_productCode_key"
ON "benefit_grants"("sourceOrderId", "productCode");

CREATE INDEX "benefit_grants_status_nextRetryAt_createdAt_idx"
ON "benefit_grants"("status", "nextRetryAt", "createdAt");

CREATE INDEX "benefit_grants_userId_createdAt_idx"
ON "benefit_grants"("userId", "createdAt");
