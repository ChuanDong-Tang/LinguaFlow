-- OIO AI chat → 对话卡 (2026-11). Additive; existing rows keep the defaults.
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "dialogue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_threads" ADD COLUMN IF NOT EXISTS "cardId" TEXT;
