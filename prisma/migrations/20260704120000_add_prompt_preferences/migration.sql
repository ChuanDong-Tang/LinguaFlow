ALTER TABLE "user_preferences"
  ADD COLUMN "promptDifficulty" TEXT NOT NULL DEFAULT 'natural',
  ADD COLUMN "promptStyle" TEXT NOT NULL DEFAULT 'native_casual',
  ADD COLUMN "guideState" JSONB NOT NULL DEFAULT '{}';
