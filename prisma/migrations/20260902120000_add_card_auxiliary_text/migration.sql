ALTER TABLE "cards"
ADD COLUMN "auxiliarySegments" JSONB,
ADD COLUMN "auxiliaryLanguageCode" TEXT,
ADD COLUMN "auxiliarySourceHash" TEXT;
