CREATE TYPE "AutoRenewProvider" AS ENUM ('wechat', 'apple');

CREATE TYPE "AutoRenewStatus" AS ENUM ('pending', 'active', 'cancelled', 'expired', 'billing_retry', 'paused');

CREATE TYPE "AutoRenewChargeStatus" AS ENUM ('scheduled', 'pending', 'paid', 'failed', 'refunded');

CREATE TABLE "auto_renew_subscriptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "AutoRenewProvider" NOT NULL,
  "productCode" TEXT NOT NULL,
  "status" "AutoRenewStatus" NOT NULL,
  "providerAgreementId" TEXT NOT NULL,
  "latestTransactionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "nextBillingAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auto_renew_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auto_renew_charges" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "AutoRenewProvider" NOT NULL,
  "productCode" TEXT NOT NULL,
  "providerChargeId" TEXT NOT NULL,
  "periodKey" TEXT,
  "status" "AutoRenewChargeStatus" NOT NULL,
  "amount" INTEGER,
  "currency" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auto_renew_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auto_renew_subscriptions_provider_providerAgreementId_key"
ON "auto_renew_subscriptions"("provider", "providerAgreementId");

CREATE INDEX "auto_renew_subscriptions_userId_status_idx"
ON "auto_renew_subscriptions"("userId", "status");

CREATE INDEX "auto_renew_subscriptions_status_nextBillingAt_idx"
ON "auto_renew_subscriptions"("status", "nextBillingAt");

CREATE UNIQUE INDEX "auto_renew_charges_provider_providerChargeId_key"
ON "auto_renew_charges"("provider", "providerChargeId");

CREATE UNIQUE INDEX "auto_renew_charges_subscriptionId_periodKey_key"
ON "auto_renew_charges"("subscriptionId", "periodKey");

CREATE INDEX "auto_renew_charges_subscriptionId_createdAt_idx"
ON "auto_renew_charges"("subscriptionId", "createdAt");

CREATE INDEX "auto_renew_charges_userId_createdAt_idx"
ON "auto_renew_charges"("userId", "createdAt");

CREATE INDEX "auto_renew_charges_status_createdAt_idx"
ON "auto_renew_charges"("status", "createdAt");

ALTER TABLE "auto_renew_subscriptions"
ADD CONSTRAINT "auto_renew_subscriptions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auto_renew_charges"
ADD CONSTRAINT "auto_renew_charges_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "auto_renew_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
