CREATE TABLE "tts_request_logs" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "userId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "assetId" TEXT,
  "provider" TEXT NOT NULL,
  "voiceCode" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL,
  "sourceTextHash" TEXT NOT NULL,
  "sourceTextChars" INTEGER NOT NULL,
  "cacheHit" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL,
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tts_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tts_request_logs_requestId_idx" ON "tts_request_logs"("requestId");
CREATE INDEX "tts_request_logs_userId_createdAt_idx" ON "tts_request_logs"("userId", "createdAt");
CREATE INDEX "tts_request_logs_status_createdAt_idx" ON "tts_request_logs"("status", "createdAt");
CREATE INDEX "tts_request_logs_provider_languageCode_createdAt_idx" ON "tts_request_logs"("provider", "languageCode", "createdAt");
CREATE INDEX "tts_assets_status_updatedAt_idx" ON "tts_assets"("status", "updatedAt");

ALTER TABLE "tts_request_logs"
  ADD CONSTRAINT "tts_request_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
