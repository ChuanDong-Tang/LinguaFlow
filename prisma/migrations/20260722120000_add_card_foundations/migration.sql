CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "card_collections" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_collections_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cards"
  ADD COLUMN "topic" TEXT,
  ADD COLUMN "topicEditedAt" TIMESTAMP(3),
  ADD COLUMN "collectionId" TEXT;

CREATE TABLE "card_embeddings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "inputHash" TEXT NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_embeddings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_embeddings_dimensions_check" CHECK ("dimensions" = 1536)
);

CREATE TABLE "phrases" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL,
  "canonicalText" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_normalization',
  "normalizerVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "phrases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "phrase_variants" (
  "id" TEXT NOT NULL,
  "phraseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL,
  "surfaceText" TEXT NOT NULL,
  "normalizedText" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "normalizerVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phrase_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "phrase_occurrences" (
  "id" TEXT NOT NULL,
  "phraseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "cardCreatedAt" TIMESTAMP(3) NOT NULL,
  "sourceField" TEXT NOT NULL,
  "segmentId" TEXT,
  "segmentKey" TEXT NOT NULL DEFAULT '',
  "startUtf16" INTEGER NOT NULL,
  "endUtf16" INTEGER NOT NULL,
  "surfaceText" TEXT NOT NULL,
  "matchType" TEXT NOT NULL,
  "clozeBlankId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "phrase_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "phrase_occurrences_source_field_check" CHECK ("sourceField" IN ('original', 'ai_expression')),
  CONSTRAINT "phrase_occurrences_offsets_check" CHECK ("startUtf16" >= 0 AND "endUtf16" > "startUtf16"),
  CONSTRAINT "phrase_occurrences_segment_check" CHECK (
    ("sourceField" = 'original' AND "segmentId" IS NULL AND "segmentKey" = '') OR
    ("sourceField" = 'ai_expression' AND "segmentId" IS NOT NULL AND "segmentKey" = "segmentId")
  )
);

CREATE TABLE "card_enrichment_jobs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "workerId" TEXT,
  "inputHash" TEXT NOT NULL,
  "inputVersion" TEXT NOT NULL,
  "payload" JSONB,
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "card_enrichment_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_enrichment_jobs_attempts_check" CHECK ("attempts" >= 0)
);

CREATE TABLE "recall_sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seedCardId" TEXT NOT NULL,
  "launchMode" TEXT NOT NULL,
  "launchContext" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recall_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recall_session_nodes" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'unvisited',
  "ordinal" INTEGER NOT NULL,
  "openedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recall_session_nodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recall_session_nodes_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "recall_session_edges" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "fromNodeId" TEXT NOT NULL,
  "toNodeId" TEXT NOT NULL,
  "relationKey" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "phraseId" TEXT,
  "reasons" JSONB NOT NULL,
  "isDirected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recall_session_edges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recall_session_edges_distinct_nodes_check" CHECK ("fromNodeId" <> "toNodeId"),
  CONSTRAINT "recall_session_edges_relation_key_check" CHECK (length("relationKey") > 0),
  CONSTRAINT "recall_session_edges_undirected_order_check" CHECK ("isDirected" OR "fromNodeId" < "toNodeId")
);

CREATE UNIQUE INDEX "card_collections_userId_normalizedName_key" ON "card_collections"("userId", "normalizedName");
CREATE INDEX "card_collections_userId_updatedAt_idx" ON "card_collections"("userId", "updatedAt" DESC);
CREATE INDEX "cards_userId_collectionId_createdAt_idx" ON "cards"("userId", "collectionId", "createdAt" DESC);
CREATE INDEX "cards_collectionId_idx" ON "cards"("collectionId");
CREATE UNIQUE INDEX "card_embeddings_cardId_modelVersion_key" ON "card_embeddings"("cardId", "modelVersion");
CREATE INDEX "card_embeddings_userId_modelVersion_idx" ON "card_embeddings"("userId", "modelVersion");
CREATE UNIQUE INDEX "phrases_userId_languageCode_canonicalKey_key" ON "phrases"("userId", "languageCode", "canonicalKey");
CREATE INDEX "phrases_userId_languageCode_status_idx" ON "phrases"("userId", "languageCode", "status");
CREATE UNIQUE INDEX "phrase_variants_phraseId_normalizedText_key" ON "phrase_variants"("phraseId", "normalizedText");
CREATE INDEX "phrase_variants_userId_languageCode_normalizedText_idx" ON "phrase_variants"("userId", "languageCode", "normalizedText");
CREATE UNIQUE INDEX "phrase_occurrences_phraseId_cardId_sourceField_segmentKey_startUtf16_endUtf16_key" ON "phrase_occurrences"("phraseId", "cardId", "sourceField", "segmentKey", "startUtf16", "endUtf16");
CREATE INDEX "phrase_occurrences_phraseId_cardId_idx" ON "phrase_occurrences"("phraseId", "cardId");
CREATE INDEX "phrase_occurrences_userId_cardId_sourceField_phraseId_idx" ON "phrase_occurrences"("userId", "cardId", "sourceField", "phraseId");
CREATE INDEX "phrase_occurrences_userId_phraseId_sourceField_cardCreatedAt_idx" ON "phrase_occurrences"("userId", "phraseId", "sourceField", "cardCreatedAt");
CREATE UNIQUE INDEX "card_enrichment_jobs_userId_sourceKind_sourceId_jobType_inputVersion_key" ON "card_enrichment_jobs"("userId", "sourceKind", "sourceId", "jobType", "inputVersion");
CREATE INDEX "card_enrichment_jobs_status_availableAt_leaseExpiresAt_createdAt_idx" ON "card_enrichment_jobs"("status", "availableAt", "leaseExpiresAt", "createdAt");
CREATE INDEX "card_enrichment_jobs_userId_sourceKind_sourceId_createdAt_idx" ON "card_enrichment_jobs"("userId", "sourceKind", "sourceId", "createdAt");
CREATE INDEX "recall_sessions_userId_status_updatedAt_idx" ON "recall_sessions"("userId", "status", "updatedAt" DESC);
CREATE UNIQUE INDEX "recall_sessions_one_active_per_user_idx" ON "recall_sessions"("userId") WHERE "status" = 'active';
CREATE UNIQUE INDEX "recall_session_nodes_sessionId_cardId_key" ON "recall_session_nodes"("sessionId", "cardId");
CREATE UNIQUE INDEX "recall_session_nodes_sessionId_ordinal_key" ON "recall_session_nodes"("sessionId", "ordinal");
CREATE INDEX "recall_session_nodes_sessionId_state_idx" ON "recall_session_nodes"("sessionId", "state");
CREATE UNIQUE INDEX "recall_session_edges_sessionId_fromNodeId_toNodeId_relationKey_key" ON "recall_session_edges"("sessionId", "fromNodeId", "toNodeId", "relationKey");
CREATE INDEX "recall_session_edges_sessionId_fromNodeId_idx" ON "recall_session_edges"("sessionId", "fromNodeId");
CREATE INDEX "recall_session_edges_sessionId_toNodeId_idx" ON "recall_session_edges"("sessionId", "toNodeId");
CREATE INDEX "recall_session_edges_phraseId_idx" ON "recall_session_edges"("phraseId");

ALTER TABLE "card_collections" ADD CONSTRAINT "card_collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cards" ADD CONSTRAINT "cards_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "card_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "card_embeddings" ADD CONSTRAINT "card_embeddings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_embeddings" ADD CONSTRAINT "card_embeddings_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_variants" ADD CONSTRAINT "phrase_variants_phraseId_fkey" FOREIGN KEY ("phraseId") REFERENCES "phrases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_variants" ADD CONSTRAINT "phrase_variants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_occurrences" ADD CONSTRAINT "phrase_occurrences_phraseId_fkey" FOREIGN KEY ("phraseId") REFERENCES "phrases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_occurrences" ADD CONSTRAINT "phrase_occurrences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "phrase_occurrences" ADD CONSTRAINT "phrase_occurrences_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_enrichment_jobs" ADD CONSTRAINT "card_enrichment_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_sessions" ADD CONSTRAINT "recall_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_sessions" ADD CONSTRAINT "recall_sessions_seedCardId_fkey" FOREIGN KEY ("seedCardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_session_nodes" ADD CONSTRAINT "recall_session_nodes_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "recall_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_session_nodes" ADD CONSTRAINT "recall_session_nodes_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_session_edges" ADD CONSTRAINT "recall_session_edges_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "recall_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_session_edges" ADD CONSTRAINT "recall_session_edges_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "recall_session_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_session_edges" ADD CONSTRAINT "recall_session_edges_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "recall_session_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recall_session_edges" ADD CONSTRAINT "recall_session_edges_phraseId_fkey" FOREIGN KEY ("phraseId") REFERENCES "phrases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION "validate_recall_edge_session"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "recall_session_nodes" AS from_node
      JOIN "recall_session_nodes" AS to_node ON to_node."id" = NEW."toNodeId"
     WHERE from_node."id" = NEW."fromNodeId"
       AND from_node."sessionId" = NEW."sessionId"
       AND to_node."sessionId" = NEW."sessionId"
  ) THEN
    RAISE EXCEPTION 'Recall edge nodes must belong to the same session' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "recall_session_edges_same_session_trigger"
BEFORE INSERT OR UPDATE OF "sessionId", "fromNodeId", "toNodeId" ON "recall_session_edges"
FOR EACH ROW EXECUTE FUNCTION "validate_recall_edge_session"();
