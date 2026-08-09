CREATE TABLE "ai_token_cycles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiVersion" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "quotaTokens" INTEGER NOT NULL,
  "reservedTokens" INTEGER NOT NULL DEFAULT 0,
  "usedTokens" INTEGER NOT NULL DEFAULT 0,
  "grantSource" TEXT NOT NULL,
  "configVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_token_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_token_cycles_nonnegative" CHECK (
    "quotaTokens" >= 0 AND "reservedTokens" >= 0 AND "usedTokens" >= 0
  ),
  CONSTRAINT "ai_token_cycles_within_quota" CHECK (
    "reservedTokens" + "usedTokens" <= "quotaTokens"
  ),
  CONSTRAINT "ai_token_cycles_valid_period" CHECK ("periodEnd" > "periodStart")
);

CREATE TABLE "usage_v2_system_state" (
  "key" TEXT NOT NULL,
  "launchedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_v2_system_state_pkey" PRIMARY KEY ("key")
);

INSERT INTO "usage_v2_system_state" ("key", "launchedAt", "updatedAt")
VALUES ('launch', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "ai_token_transactions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reservedTokens" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "meteringSource" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "metadata" JSONB,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_token_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_token_transactions_nonnegative" CHECK (
    "reservedTokens" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0 AND "totalTokens" >= 0
  )
);

CREATE TABLE "image_storage_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "capacityBytes" BIGINT NOT NULL,
  "reservedBytes" BIGINT NOT NULL DEFAULT 0,
  "usedBytes" BIGINT NOT NULL DEFAULT 0,
  "configVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "image_storage_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "image_storage_accounts_nonnegative" CHECK (
    "capacityBytes" >= 0 AND "reservedBytes" >= 0 AND "usedBytes" >= 0
  )
);

CREATE TABLE "image_storage_transactions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL,
  "imageId" TEXT,
  "objectKey" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "image_storage_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "image_storage_transactions_nonnegative" CHECK ("bytes" >= 0)
);

CREATE UNIQUE INDEX "ai_token_cycles_userId_apiVersion_periodStart_key"
  ON "ai_token_cycles"("userId", "apiVersion", "periodStart");
CREATE INDEX "ai_token_cycles_userId_apiVersion_periodEnd_idx"
  ON "ai_token_cycles"("userId", "apiVersion", "periodEnd");
CREATE UNIQUE INDEX "ai_token_transactions_userId_requestId_key"
  ON "ai_token_transactions"("userId", "requestId");
CREATE INDEX "ai_token_transactions_cycleId_status_createdAt_idx"
  ON "ai_token_transactions"("cycleId", "status", "createdAt");
CREATE INDEX "ai_token_transactions_userId_feature_createdAt_idx"
  ON "ai_token_transactions"("userId", "feature", "createdAt");
CREATE UNIQUE INDEX "image_storage_accounts_userId_key"
  ON "image_storage_accounts"("userId");
CREATE UNIQUE INDEX "image_storage_transactions_userId_requestId_kind_key"
  ON "image_storage_transactions"("userId", "requestId", "kind");
CREATE INDEX "image_storage_transactions_accountId_status_createdAt_idx"
  ON "image_storage_transactions"("accountId", "status", "createdAt");
CREATE INDEX "image_storage_transactions_userId_dateKey_kind_status_idx"
  ON "image_storage_transactions"("userId", "dateKey", "kind", "status");
CREATE INDEX "image_storage_transactions_userId_imageId_idx"
  ON "image_storage_transactions"("userId", "imageId");

ALTER TABLE "ai_token_cycles" ADD CONSTRAINT "ai_token_cycles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_token_transactions" ADD CONSTRAINT "ai_token_transactions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_token_transactions" ADD CONSTRAINT "ai_token_transactions_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "ai_token_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "image_storage_accounts" ADD CONSTRAINT "image_storage_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "image_storage_transactions" ADD CONSTRAINT "image_storage_transactions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "image_storage_transactions" ADD CONSTRAINT "image_storage_transactions_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "image_storage_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
