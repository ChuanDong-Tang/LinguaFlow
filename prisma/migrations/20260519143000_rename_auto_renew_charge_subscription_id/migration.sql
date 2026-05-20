ALTER TABLE "auto_renew_charges"
RENAME COLUMN "subscriptionId" TO "autoRenewSubscriptionId";

ALTER INDEX "auto_renew_charges_subscriptionId_periodKey_key"
RENAME TO "auto_renew_charges_autoRenewSubscriptionId_periodKey_key";

ALTER INDEX "auto_renew_charges_subscriptionId_createdAt_idx"
RENAME TO "auto_renew_charges_autoRenewSubscriptionId_createdAt_idx";

ALTER TABLE "auto_renew_charges"
RENAME CONSTRAINT "auto_renew_charges_subscriptionId_fkey"
TO "auto_renew_charges_autoRenewSubscriptionId_fkey";
