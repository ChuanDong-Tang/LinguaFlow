ALTER TABLE "card_collections"
ADD COLUMN "parentId" TEXT;

ALTER TABLE "card_collections"
ADD CONSTRAINT "card_collections_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "card_collections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "card_collections_userId_parentId_idx"
ON "card_collections"("userId", "parentId");
