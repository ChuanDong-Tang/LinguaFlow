ALTER TABLE "messages" ADD COLUMN "conversationDateKey" TEXT;

UPDATE "messages" AS m
SET "conversationDateKey" = COALESCE(
  c."dateKey",
  to_char(m."createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
)
FROM "conversations" AS c
WHERE c."id" = m."conversationId"
  AND m."conversationDateKey" IS NULL;

UPDATE "messages" AS m
SET "conversationDateKey" = to_char(m."createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
WHERE m."conversationDateKey" IS NULL;

CREATE INDEX "messages_conversationId_conversationDateKey_createdAt_idx"
  ON "messages"("conversationId", "conversationDateKey", "createdAt");

CREATE INDEX "messages_userId_conversationDateKey_idx"
  ON "messages"("userId", "conversationDateKey");
