ALTER TABLE "card_collections"
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "parentId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) - 1 AS position
  FROM "card_collections"
)
UPDATE "card_collections" AS collection
SET "sortOrder" = ranked.position
FROM ranked
WHERE collection."id" = ranked."id";

DROP INDEX IF EXISTS "card_collections_userId_parentId_idx";

CREATE INDEX "card_collections_userId_parentId_sortOrder_idx"
ON "card_collections"("userId", "parentId", "sortOrder");
