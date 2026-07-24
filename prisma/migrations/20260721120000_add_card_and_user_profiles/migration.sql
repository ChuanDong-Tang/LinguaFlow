CREATE TABLE "user_profiles" (
  "userId" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "nicknameSource" TEXT NOT NULL DEFAULT 'default_generated',
  "registrationMethod" TEXT NOT NULL,
  "avatarAssetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "user_avatar_assets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "originalObjectKey" TEXT NOT NULL,
  "uploadObjectKey" TEXT,
  "profileObjectKey" TEXT,
  "thumbnailObjectKey" TEXT,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "fileMd5" TEXT,
  "moderationRequestId" TEXT,
  "moderationSuggestion" TEXT,
  "moderationLabel" TEXT,
  "moderationSubLabel" TEXT,
  "moderationScore" DOUBLE PRECISION,
  "moderatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_avatar_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cards" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "originalText" TEXT,
  "rewrittenText" TEXT,
  "languageCode" TEXT NOT NULL,
  "promptDifficultySnapshot" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "clientId" TEXT NOT NULL,
  "inputChars" INTEGER NOT NULL DEFAULT 0,
  "outputChars" INTEGER NOT NULL DEFAULT 0,
  "isSample" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "processingAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "workerId" TEXT,
  "failedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "card_rewrite_segments" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "startUtf16" INTEGER NOT NULL,
  "endUtf16" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "card_rewrite_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "card_image_assets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entryId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "originalObjectKey" TEXT NOT NULL,
  "uploadObjectKey" TEXT,
  "thumbnailObjectKey" TEXT,
  "thumbnailStatus" TEXT NOT NULL DEFAULT 'pending',
  "thumbnailVersion" INTEGER NOT NULL DEFAULT 1,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "fileMd5" TEXT,
  "moderationRequestId" TEXT,
  "moderationSuggestion" TEXT,
  "moderationLabel" TEXT,
  "moderatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_image_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "card_practice_states" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "clozeState" JSONB,
  "clozeVersion" INTEGER NOT NULL DEFAULT 0,
  "clozeLastResult" TEXT,
  "clozeCorrectStreak" INTEGER NOT NULL DEFAULT 0,
  "clozeNextReviewAt" TIMESTAMP(3),
  "dictationLastResult" TEXT,
  "dictationCorrectStreak" INTEGER NOT NULL DEFAULT 0,
  "dictationNextReviewAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_practice_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "card_speech_assets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entryId" TEXT,
  "segmentId" TEXT,
  "sourceKind" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "voiceCode" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL,
  "sourceText" TEXT NOT NULL,
  "sourceTextHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "objectKey" TEXT NOT NULL,
  "objectUrl" TEXT,
  "objectUrlExpiresAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "wordMarks" JSONB,
  "sentenceMarks" JSONB,
  "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_speech_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_profiles_avatarAssetId_key" ON "user_profiles"("avatarAssetId");
CREATE INDEX "user_profiles_nicknameSource_updatedAt_idx" ON "user_profiles"("nicknameSource", "updatedAt");
CREATE INDEX "user_avatar_assets_userId_createdAt_idx" ON "user_avatar_assets"("userId", "createdAt");
CREATE INDEX "user_avatar_assets_status_expiresAt_idx" ON "user_avatar_assets"("status", "expiresAt");
CREATE UNIQUE INDEX "cards_userId_clientId_key" ON "cards"("userId", "clientId");
CREATE INDEX "cards_userId_dateKey_createdAt_idx" ON "cards"("userId", "dateKey", "createdAt");
CREATE INDEX "cards_userId_status_createdAt_idx" ON "cards"("userId", "status", "createdAt");
CREATE INDEX "cards_status_leaseExpiresAt_createdAt_idx" ON "cards"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "cards_publishedAt_idx" ON "cards"("publishedAt");
CREATE UNIQUE INDEX "cards_one_active_per_user_idx" ON "cards"("userId") WHERE "status" IN ('queued', 'processing');
CREATE UNIQUE INDEX "card_rewrite_segments_entryId_ordinal_key" ON "card_rewrite_segments"("entryId", "ordinal");
CREATE INDEX "card_rewrite_segments_entryId_startUtf16_idx" ON "card_rewrite_segments"("entryId", "startUtf16");
CREATE UNIQUE INDEX "card_image_assets_entryId_key" ON "card_image_assets"("entryId");
CREATE INDEX "card_image_assets_userId_createdAt_idx" ON "card_image_assets"("userId", "createdAt");
CREATE INDEX "card_image_assets_status_expiresAt_idx" ON "card_image_assets"("status", "expiresAt");
CREATE INDEX "card_image_assets_thumbnailStatus_updatedAt_idx" ON "card_image_assets"("thumbnailStatus", "updatedAt");
CREATE UNIQUE INDEX "card_practice_states_cardId_key" ON "card_practice_states"("cardId");
CREATE INDEX "card_practice_states_userId_clozeNextReviewAt_idx" ON "card_practice_states"("userId", "clozeNextReviewAt");
CREATE INDEX "card_practice_states_userId_dictationNextReviewAt_idx" ON "card_practice_states"("userId", "dictationNextReviewAt");
CREATE UNIQUE INDEX "card_speech_assets_cacheKey_key" ON "card_speech_assets"("cacheKey");
CREATE INDEX "card_speech_assets_userId_createdAt_idx" ON "card_speech_assets"("userId", "createdAt");
CREATE INDEX "card_speech_assets_entryId_sourceKind_idx" ON "card_speech_assets"("entryId", "sourceKind");
CREATE INDEX "card_speech_assets_status_updatedAt_idx" ON "card_speech_assets"("status", "updatedAt");
CREATE INDEX "card_speech_assets_sourceKind_lastAccessedAt_idx" ON "card_speech_assets"("sourceKind", "lastAccessedAt");

ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "user_avatar_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_avatar_assets" ADD CONSTRAINT "user_avatar_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cards" ADD CONSTRAINT "cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_rewrite_segments" ADD CONSTRAINT "card_rewrite_segments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_image_assets" ADD CONSTRAINT "card_image_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_image_assets" ADD CONSTRAINT "card_image_assets_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "card_practice_states" ADD CONSTRAINT "card_practice_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_practice_states" ADD CONSTRAINT "card_practice_states_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_speech_assets" ADD CONSTRAINT "card_speech_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_speech_assets" ADD CONSTRAINT "card_speech_assets_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing accounts intentionally stop displaying Authing-provided names.
-- The suffix uses the same ambiguity-free alphabet as application-created profiles.
INSERT INTO "user_profiles" ("userId", "nickname", "nicknameSource", "registrationMethod", "createdAt", "updatedAt")
SELECT
  "id",
  'OIO-' ||
    SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + MOD(GET_BYTE(DECODE(MD5("id" || RANDOM()::TEXT), 'hex'), 0), 32), 1) ||
    SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + MOD(GET_BYTE(DECODE(MD5("id" || RANDOM()::TEXT), 'hex'), 1), 32), 1) ||
    SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + MOD(GET_BYTE(DECODE(MD5("id" || RANDOM()::TEXT), 'hex'), 2), 32), 1) ||
    SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + MOD(GET_BYTE(DECODE(MD5("id" || RANDOM()::TEXT), 'hex'), 3), 32), 1) ||
    SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + MOD(GET_BYTE(DECODE(MD5("id" || RANDOM()::TEXT), 'hex'), 4), 32), 1) ||
    SUBSTRING('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + MOD(GET_BYTE(DECODE(MD5("id" || RANDOM()::TEXT), 'hex'), 5), 32), 1),
  'default_generated',
  CASE WHEN NULLIF(BTRIM("phone"), '') IS NOT NULL THEN 'phone' ELSE 'email' END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users"
ON CONFLICT ("userId") DO NOTHING;
