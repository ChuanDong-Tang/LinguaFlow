CREATE INDEX "conversations_userId_archivedAt_dateKey_id_idx"
ON "conversations"("userId", "archivedAt", "dateKey" DESC, "id" DESC);
