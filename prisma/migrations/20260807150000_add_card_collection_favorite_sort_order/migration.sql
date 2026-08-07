ALTER TABLE "card_collections"
ADD COLUMN "favoriteSortOrder" INTEGER;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "userId"
    ORDER BY "sortOrder" ASC, "createdAt" ASC, "id" ASC
  ) - 1 AS position
  FROM "card_collections"
  WHERE "isFavorite" = TRUE
)
UPDATE "card_collections" AS collection
SET "favoriteSortOrder" = ranked.position
FROM ranked
WHERE collection."id" = ranked."id";

CREATE INDEX "card_collections_userId_isFavorite_favoriteSortOrder_idx"
ON "card_collections"("userId", "isFavorite", "favoriteSortOrder");
