-- Podcast mode: cached AI theme grouping per user, and an optional folder cover
-- (an image id from one of the folder's own cards). Additive only.
CREATE TABLE "card_theme_snapshots" (
  "userId" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "themes" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_theme_snapshots_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "card_theme_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "card_collections" ADD COLUMN "coverImageId" TEXT;
