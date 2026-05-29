-- Apple IAP appAccountToken -> userId mapping for server notification recovery.
CREATE TABLE "apple_iap_account_links" (
    "appAccountToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalTransactionId" TEXT,
    "latestTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apple_iap_account_links_pkey" PRIMARY KEY ("appAccountToken")
);

CREATE INDEX "apple_iap_account_links_userId_idx" ON "apple_iap_account_links"("userId");
CREATE INDEX "apple_iap_account_links_originalTransactionId_idx" ON "apple_iap_account_links"("originalTransactionId");

ALTER TABLE "apple_iap_account_links"
ADD CONSTRAINT "apple_iap_account_links_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
