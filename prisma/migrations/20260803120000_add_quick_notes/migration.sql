CREATE TABLE "quick_notes" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "legacyMessageId" TEXT,
  "dateKey" TEXT NOT NULL,
  "originalText" TEXT NOT NULL,
  "expressionText" TEXT,
  "translationText" TEXT,
  "replyText" TEXT,
  "expressionStatus" TEXT NOT NULL DEFAULT 'idle',
  "translationStatus" TEXT NOT NULL DEFAULT 'idle',
  "replyStatus" TEXT NOT NULL DEFAULT 'idle',
  "convertedCardId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quick_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quick_notes_userId_clientId_key"
  ON "quick_notes"("userId", "clientId");

CREATE UNIQUE INDEX "quick_notes_userId_legacyMessageId_key"
  ON "quick_notes"("userId", "legacyMessageId");

CREATE INDEX "quick_notes_userId_dateKey_createdAt_idx"
  ON "quick_notes"("userId", "dateKey", "createdAt");

CREATE INDEX "quick_notes_userId_createdAt_idx"
  ON "quick_notes"("userId", "createdAt" DESC);

ALTER TABLE "quick_notes"
  ADD CONSTRAINT "quick_notes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
