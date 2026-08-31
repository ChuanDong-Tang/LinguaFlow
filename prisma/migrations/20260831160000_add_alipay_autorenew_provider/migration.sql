ALTER TYPE "AutoRenewProvider" ADD VALUE IF NOT EXISTS 'alipay';

CREATE TABLE "alipay_account_links" (
    "userId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "alipay_account_links_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "alipay_account_links_customerId_key" ON "alipay_account_links"("customerId");

ALTER TABLE "alipay_account_links"
ADD CONSTRAINT "alipay_account_links_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Application-level checks provide friendly errors; this partial index is the
-- final guard against two concurrent payment requests opening two agreements.
CREATE UNIQUE INDEX "auto_renew_subscriptions_one_current_per_user_key"
ON "auto_renew_subscriptions" ("userId")
WHERE "status" IN ('pending', 'active', 'billing_retry', 'paused');
