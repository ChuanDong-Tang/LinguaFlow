ALTER TABLE "cards"
ADD COLUMN "appLocaleSnapshot" TEXT;

UPDATE "cards" AS card
SET "appLocaleSnapshot" = COALESCE(
  (
    SELECT preference."appLocale"
    FROM "user_preferences" AS preference
    WHERE preference."userId" = card."userId"
  ),
  'zh-CN'
)
WHERE card."appLocaleSnapshot" IS NULL;

ALTER TABLE "cards"
ALTER COLUMN "appLocaleSnapshot" SET NOT NULL;
