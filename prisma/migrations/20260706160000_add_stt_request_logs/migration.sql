CREATE TABLE "stt_request_logs" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'realtime',
  "languageIdMode" TEXT NOT NULL,
  "candidateLanguages" JSONB NOT NULL,
  "detectedLanguage" TEXT,
  "languageDetectionConfidence" TEXT,
  "audioFormat" TEXT NOT NULL DEFAULT 'pcm_s16le',
  "sampleRate" INTEGER NOT NULL,
  "channels" INTEGER NOT NULL,
  "bitsPerSample" INTEGER NOT NULL,
  "audioBytes" INTEGER NOT NULL DEFAULT 0,
  "audioDurationMs" INTEGER NOT NULL DEFAULT 0,
  "billableSeconds" INTEGER NOT NULL DEFAULT 0,
  "transcriptChars" INTEGER NOT NULL DEFAULT 0,
  "recognizedTextPresent" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL,
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stt_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stt_request_logs_requestId_idx" ON "stt_request_logs"("requestId");
CREATE INDEX "stt_request_logs_userId_createdAt_idx" ON "stt_request_logs"("userId", "createdAt");
CREATE INDEX "stt_request_logs_status_createdAt_idx" ON "stt_request_logs"("status", "createdAt");
CREATE INDEX "stt_request_logs_provider_languageIdMode_createdAt_idx" ON "stt_request_logs"("provider", "languageIdMode", "createdAt");

ALTER TABLE "stt_request_logs"
  ADD CONSTRAINT "stt_request_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
