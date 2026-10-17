-- Existing accounts are not new-user reward candidates. New inserts default true.
ALTER TABLE "users" ADD COLUMN "referralEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ALTER COLUMN "referralEligible" SET DEFAULT true;
CREATE TABLE "referral_codes" (
  "code" TEXT PRIMARY KEY, "partnerName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER, "redemptionCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK ("maxRedemptions" IS NULL OR "maxRedemptions" > 0),
  CHECK ("redemptionCount" >= 0)
);
CREATE TABLE "referral_redemptions" (
  "userId" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code" TEXT NOT NULL REFERENCES "referral_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "grantedPoints" INTEGER NOT NULL DEFAULT 10000,
  "usedPoints" INTEGER NOT NULL DEFAULT 0, "reservedPoints" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK ("grantedPoints" = 10000 AND "usedPoints" >= 0 AND "reservedPoints" >= 0
    AND "usedPoints" + "reservedPoints" <= "grantedPoints")
);
CREATE INDEX "referral_redemptions_code_createdAt_idx" ON "referral_redemptions"("code", "createdAt");
ALTER TABLE "ai_token_transactions" ADD COLUMN "bonusReservedTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonusUsedTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_token_transactions" ADD CONSTRAINT "ai_token_bonus_allocation_valid"
  CHECK ("bonusReservedTokens" >= 0 AND "bonusReservedTokens" <= "reservedTokens"
    AND "bonusUsedTokens" >= 0 AND "bonusUsedTokens" <= "totalTokens");
