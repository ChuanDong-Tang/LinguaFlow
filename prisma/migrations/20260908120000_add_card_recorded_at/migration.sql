ALTER TABLE "cards"
ADD COLUMN "recordedAt" TIMESTAMP(3);

UPDATE "cards"
SET "recordedAt" = "createdAt"
WHERE "recordedAt" IS NULL;

ALTER TABLE "cards"
ALTER COLUMN "recordedAt" SET NOT NULL,
ALTER COLUMN "recordedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "cards_userId_dateKey_recordedAt_idx"
ON "cards"("userId", "dateKey", "recordedAt");

CREATE INDEX "cards_userId_collectionId_recordedAt_idx"
ON "cards"("userId", "collectionId", "recordedAt" DESC);
