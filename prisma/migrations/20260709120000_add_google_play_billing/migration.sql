ALTER TYPE "AutoRenewProvider" ADD VALUE IF NOT EXISTS 'google_play';

CREATE TABLE IF NOT EXISTS "google_play_account_links" (
  "obfuscatedAccountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purchaseToken" TEXT,
  "latestOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_play_account_links_pkey" PRIMARY KEY ("obfuscatedAccountId"),
  CONSTRAINT "google_play_account_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "google_play_account_links_userId_idx" ON "google_play_account_links"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "google_play_account_links_purchaseToken_key" ON "google_play_account_links"("purchaseToken");
