CREATE TABLE "card_content_segments" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startUtf16" INTEGER NOT NULL,
    "endUtf16" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "card_content_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "card_content_practice_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentVersion" TEXT NOT NULL,
    "clozeState" JSONB,
    "clozeVersion" INTEGER NOT NULL DEFAULT 0,
    "clozeLastResult" TEXT,
    "clozeCorrectStreak" INTEGER NOT NULL DEFAULT 0,
    "clozeNextReviewAt" TIMESTAMP(3),
    "dictationLastResult" TEXT,
    "dictationCorrectStreak" INTEGER NOT NULL DEFAULT 0,
    "dictationNextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "card_content_practice_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "card_content_segments_entryId_contentType_ordinal_key"
ON "card_content_segments"("entryId", "contentType", "ordinal");
CREATE INDEX "card_content_segments_entryId_contentType_startUtf16_idx"
ON "card_content_segments"("entryId", "contentType", "startUtf16");
CREATE INDEX "card_content_segments_entryId_contentType_contentVersion_idx"
ON "card_content_segments"("entryId", "contentType", "contentVersion");
CREATE UNIQUE INDEX "card_content_practice_states_cardId_contentType_key"
ON "card_content_practice_states"("cardId", "contentType");
CREATE INDEX "card_content_practice_states_userId_contentType_clozeNextReviewAt_idx"
ON "card_content_practice_states"("userId", "contentType", "clozeNextReviewAt");
CREATE INDEX "card_content_practice_states_userId_contentType_dictationNextReviewAt_idx"
ON "card_content_practice_states"("userId", "contentType", "dictationNextReviewAt");

ALTER TABLE "card_content_segments"
ADD CONSTRAINT "card_content_segments_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_content_practice_states"
ADD CONSTRAINT "card_content_practice_states_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_content_practice_states"
ADD CONSTRAINT "card_content_practice_states_cardId_fkey"
FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "card_content_segments" (
    "id", "entryId", "contentType", "contentVersion", "ordinal", "text", "startUtf16", "endUtf16", "createdAt", "updatedAt"
)
SELECT segment."id",
       segment."entryId",
       CASE WHEN card."rewrittenText" IS NOT NULL THEN 'rewrite' ELSE 'original' END,
       COALESCE(
         CASE WHEN card."rewrittenText" IS NOT NULL THEN card."rewrittenSourceHash" ELSE card."originalContentHash" END,
         'legacy:' || card."id"
       ),
       segment."ordinal",
       segment."text",
       segment."startUtf16",
       segment."endUtf16",
       segment."createdAt",
       segment."createdAt"
  FROM "card_rewrite_segments" AS segment
  JOIN "cards" AS card ON card."id" = segment."entryId"
ON CONFLICT ("id") DO NOTHING;

-- Backfill every supported content block. Existing legacy segment rows win on
-- ordinal conflicts so their ids (and cloze JSON references) remain intact.
CREATE FUNCTION "_lf_card_utf16_length"(value TEXT) RETURNS INTEGER
LANGUAGE SQL IMMUTABLE STRICT
AS $$
  SELECT COALESCE(SUM(CASE WHEN ascii(character) > 65535 THEN 2 ELSE 1 END), 0)::INTEGER
    FROM regexp_split_to_table(value, '') AS split(character)
$$;

INSERT INTO "card_content_segments" (
    "id", "entryId", "contentType", "contentVersion", "ordinal", "text", "startUtf16", "endUtf16", "createdAt", "updatedAt"
)
SELECT card."id" || ':content:original:0', card."id", 'original',
       COALESCE(card."originalContentHash", 'legacy:' || card."id"),
       0, card."originalText", 0, "_lf_card_utf16_length"(card."originalText"), card."createdAt", card."updatedAt"
  FROM "cards" AS card
 WHERE card."originalText" IS NOT NULL AND length(trim(card."originalText")) > 0
ON CONFLICT ("entryId", "contentType", "ordinal") DO NOTHING;

INSERT INTO "card_content_segments" (
    "id", "entryId", "contentType", "contentVersion", "ordinal", "text", "startUtf16", "endUtf16", "createdAt", "updatedAt"
)
SELECT card."id" || ':content:rewrite:0', card."id", 'rewrite',
       COALESCE(card."rewrittenSourceHash", card."originalContentHash", 'legacy:' || card."id"),
       0, card."rewrittenText", 0, "_lf_card_utf16_length"(card."rewrittenText"), card."createdAt", card."updatedAt"
  FROM "cards" AS card
 WHERE card."rewrittenText" IS NOT NULL AND length(trim(card."rewrittenText")) > 0
ON CONFLICT ("entryId", "contentType", "ordinal") DO NOTHING;

INSERT INTO "card_content_segments" (
    "id", "entryId", "contentType", "contentVersion", "ordinal", "text", "startUtf16", "endUtf16", "createdAt", "updatedAt"
)
SELECT card."id" || ':content:reply:0', card."id", 'reply',
       COALESCE(card."replySourceHash", card."originalContentHash", 'legacy:' || card."id"),
       0, card."replyText", 0, "_lf_card_utf16_length"(card."replyText"), card."createdAt", card."updatedAt"
  FROM "cards" AS card
 WHERE card."replyText" IS NOT NULL AND length(trim(card."replyText")) > 0
ON CONFLICT ("entryId", "contentType", "ordinal") DO NOTHING;

DROP FUNCTION "_lf_card_utf16_length"(TEXT);

INSERT INTO "card_content_practice_states" (
    "id", "userId", "cardId", "contentType", "contentVersion", "clozeState", "clozeVersion",
    "clozeLastResult", "clozeCorrectStreak", "clozeNextReviewAt",
    "dictationLastResult", "dictationCorrectStreak", "dictationNextReviewAt", "createdAt", "updatedAt"
)
SELECT state."id",
       state."userId",
       state."cardId",
       CASE WHEN card."rewrittenText" IS NOT NULL THEN 'rewrite' ELSE 'original' END,
       COALESCE(
         CASE WHEN card."rewrittenText" IS NOT NULL THEN card."rewrittenSourceHash" ELSE card."originalContentHash" END,
         'legacy:' || card."id"
       ),
       state."clozeState",
       state."clozeVersion",
       state."clozeLastResult",
       state."clozeCorrectStreak",
       state."clozeNextReviewAt",
       state."dictationLastResult",
       state."dictationCorrectStreak",
       state."dictationNextReviewAt",
       state."createdAt",
       state."updatedAt"
  FROM "card_practice_states" AS state
  JOIN "cards" AS card ON card."id" = state."cardId"
ON CONFLICT ("cardId", "contentType") DO NOTHING;
