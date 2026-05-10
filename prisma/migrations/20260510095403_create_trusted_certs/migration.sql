-- AlterEnum
ALTER TYPE "AiRequestLogStatus" ADD VALUE 'rate_limited';

-- DropIndex
DROP INDEX "payment_events_provider_providerEventId_key";

-- CreateTable
CREATE TABLE "trusted_certs" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "materialType" TEXT NOT NULL,
  "pem" TEXT NOT NULL,
  "fingerprint" TEXT,
  "notBefore" TIMESTAMP(3),
  "notAfter" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSyncedAt" TIMESTAMP(3),
  CONSTRAINT "trusted_certs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_providerEventId_eventType_key" ON "payment_events"("provider", "providerEventId", "eventType");

-- CreateIndex
CREATE INDEX "trusted_certs_provider_status_notAfter_idx" ON "trusted_certs"("provider", "status", "notAfter");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_certs_provider_keyId_materialType_key" ON "trusted_certs"("provider", "keyId", "materialType");
