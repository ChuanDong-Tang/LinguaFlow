-- CreateTable
CREATE TABLE "tts_assets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voiceCode" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "sourceTextHash" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'mp3',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "objectKey" TEXT NOT NULL,
    "objectUrl" TEXT,
    "objectUrlExpiresAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "wordMarks" JSONB,
    "sentenceMarks" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tts_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tts_assets_messageId_provider_voiceCode_sourceTextHash_key" ON "tts_assets"("messageId", "provider", "voiceCode", "sourceTextHash");

-- CreateIndex
CREATE INDEX "tts_assets_userId_createdAt_idx" ON "tts_assets"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "tts_assets_messageId_idx" ON "tts_assets"("messageId");

-- AddForeignKey
ALTER TABLE "tts_assets" ADD CONSTRAINT "tts_assets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tts_assets" ADD CONSTRAINT "tts_assets_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
