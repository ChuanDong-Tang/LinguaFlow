ALTER TABLE "user_preferences"
  ADD COLUMN "promptDifficulty" TEXT NOT NULL DEFAULT 'native',
  ADD COLUMN "guideState" JSONB NOT NULL DEFAULT '{}';
