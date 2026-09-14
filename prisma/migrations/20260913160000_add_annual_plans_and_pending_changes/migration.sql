-- Add yearly membership products and persist the current pending provider plan change.
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'plus_yearly';
ALTER TYPE "SubscriptionPlan" ADD VALUE IF NOT EXISTS 'pro_yearly';

CREATE TYPE "AutoRenewPlanChangeStatus" AS ENUM ('pending_confirmation', 'scheduled');

ALTER TABLE "auto_renew_subscriptions"
ADD COLUMN "pendingProductCode" TEXT,
ADD COLUMN "pendingChangeStatus" "AutoRenewPlanChangeStatus",
ADD COLUMN "pendingChangeEffectiveAt" TIMESTAMP(3),
ADD COLUMN "pendingChangeRequestedAt" TIMESTAMP(3);

CREATE INDEX "auto_renew_subscriptions_userId_pendingChangeStatus_idx"
ON "auto_renew_subscriptions"("userId", "pendingChangeStatus");
