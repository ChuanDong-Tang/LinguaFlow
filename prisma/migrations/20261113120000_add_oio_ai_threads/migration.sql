-- OIO AI (2026-11): conversations separate from the legacy rewrite chat. Additive only.
CREATE TABLE IF NOT EXISTS "ai_threads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "contextCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_threads_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ai_messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "blocks" JSONB,
    "trace" JSONB,
    "requestId" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_threads_userId_updatedAt_idx" ON "ai_threads"("userId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "ai_messages_threadId_createdAt_idx" ON "ai_messages"("threadId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_messages_userId_createdAt_idx" ON "ai_messages"("userId", "createdAt" DESC);
DO $$ BEGIN
  ALTER TABLE "ai_threads" ADD CONSTRAINT "ai_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ai_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
