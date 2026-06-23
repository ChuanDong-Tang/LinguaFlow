ALTER TABLE "tts_assets"
  ADD COLUMN "sourceKey" TEXT NOT NULL DEFAULT 'rewrite';

DROP INDEX IF EXISTS "tts_assets_messageId_provider_voiceCode_sourceTextHash_key";

CREATE UNIQUE INDEX "tts_assets_messageId_provider_voiceCode_languageCode_sourceKey_sourceTextHash_key"
  ON "tts_assets"("messageId", "provider", "voiceCode", "languageCode", "sourceKey", "sourceTextHash");
