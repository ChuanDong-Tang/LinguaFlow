-- Self-hosted account verification (replacing Authing). Additive only.
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3);

CREATE TABLE "auth_verification_codes" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_verification_codes_target_purpose_createdAt_idx" ON "auth_verification_codes"("target", "purpose", "createdAt");
CREATE INDEX "auth_verification_codes_requestIp_createdAt_idx" ON "auth_verification_codes"("requestIp", "createdAt");
CREATE INDEX "auth_verification_codes_createdAt_idx" ON "auth_verification_codes"("createdAt");
