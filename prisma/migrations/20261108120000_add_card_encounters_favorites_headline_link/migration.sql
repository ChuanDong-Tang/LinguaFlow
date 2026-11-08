-- 2026-11 redesign: encounter counts, card favorites, catchy headline, link attachment.
-- Additive and backward compatible; existing rows get encounterCount = 0.
ALTER TABLE "cards" ADD COLUMN "headline" TEXT;
ALTER TABLE "cards" ADD COLUMN "encounterCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cards" ADD COLUMN "lastEncounteredAt" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN "favoritedAt" TIMESTAMP(3);
ALTER TABLE "cards" ADD COLUMN "linkUrl" TEXT;
ALTER TABLE "cards" ADD COLUMN "linkProvider" TEXT;
ALTER TABLE "cards" ADD COLUMN "linkTitle" TEXT;
CREATE INDEX "cards_userId_favoritedAt_idx" ON "cards"("userId", "favoritedAt" DESC);
