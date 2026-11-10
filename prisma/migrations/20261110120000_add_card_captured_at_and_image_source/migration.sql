-- Memory time (when the photo / video was taken) and the device asset a card image came from.
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3);
ALTER TABLE "card_image_assets" ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3);
ALTER TABLE "card_image_assets" ADD COLUMN IF NOT EXISTS "sourceAssetId" TEXT;
CREATE INDEX IF NOT EXISTS "card_image_assets_userId_sourceAssetId_idx" ON "card_image_assets"("userId", "sourceAssetId");
