ALTER TABLE "cards"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "originalContentHash" TEXT,
  ADD COLUMN "rewrittenLanguageCode" TEXT,
  ADD COLUMN "rewrittenSourceHash" TEXT,
  ADD COLUMN "translationLanguageCode" TEXT,
  ADD COLUMN "translationSourceHash" TEXT,
  ADD COLUMN "replyLanguageCode" TEXT,
  ADD COLUMN "replySourceHash" TEXT;

UPDATE "cards"
SET
  "originalContentHash" = CASE
    WHEN "originalText" IS NOT NULL AND BTRIM("originalText") <> '' THEN 'md5:' || MD5(BTRIM(REPLACE("originalText", E'\r\n', E'\n')))
    ELSE NULL
  END,
  "rewrittenLanguageCode" = CASE
    WHEN "rewrittenText" IS NOT NULL AND BTRIM("rewrittenText") <> '' THEN "languageCode"
    ELSE NULL
  END,
  "translationLanguageCode" = CASE
    WHEN "translationText" IS NOT NULL AND BTRIM("translationText") <> '' THEN "appLocaleSnapshot"
    ELSE NULL
  END,
  "replyLanguageCode" = CASE
    WHEN "replyText" IS NOT NULL AND BTRIM("replyText") <> '' THEN "languageCode"
    ELSE NULL
  END,
  "rewrittenSourceHash" = CASE
    WHEN "rewrittenText" IS NOT NULL AND BTRIM("rewrittenText") <> '' AND "originalText" IS NOT NULL THEN 'md5:' || MD5(BTRIM(REPLACE("originalText", E'\r\n', E'\n')))
    ELSE NULL
  END,
  "translationSourceHash" = CASE
    WHEN "translationText" IS NOT NULL AND BTRIM("translationText") <> '' AND "originalText" IS NOT NULL THEN 'md5:' || MD5(BTRIM(REPLACE("originalText", E'\r\n', E'\n')))
    ELSE NULL
  END,
  "replySourceHash" = CASE
    WHEN "replyText" IS NOT NULL AND BTRIM("replyText") <> '' AND "originalText" IS NOT NULL THEN 'md5:' || MD5(BTRIM(REPLACE("originalText", E'\r\n', E'\n')))
    ELSE NULL
  END;
