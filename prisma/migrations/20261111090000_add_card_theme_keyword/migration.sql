-- Topic prompt v4: a short life-theme keyword shown by 相关回忆. Additive; existing rows stay NULL.
ALTER TABLE "cards" ADD COLUMN IF NOT EXISTS "themeKeyword" TEXT;
