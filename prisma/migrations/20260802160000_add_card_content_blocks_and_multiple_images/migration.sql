ALTER TABLE "cards"
  ADD COLUMN "translationText" TEXT,
  ADD COLUMN "replyText" TEXT;

DROP INDEX IF EXISTS "card_image_assets_entryId_key";

ALTER TABLE "card_image_assets"
  ADD COLUMN "ordinal" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "card_image_assets_entryId_ordinal_idx"
  ON "card_image_assets"("entryId", "ordinal");
