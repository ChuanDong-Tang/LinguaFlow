ALTER TABLE "cards"
  ADD COLUMN "phraseRecommendations" JSONB,
  ADD COLUMN "phraseRecommendationSeenAt" TIMESTAMP(3),
  ADD COLUMN "phraseRecommendationExhaustedAt" TIMESTAMP(3),
  ADD COLUMN "phraseRecommendationPromptVersion" TEXT;
