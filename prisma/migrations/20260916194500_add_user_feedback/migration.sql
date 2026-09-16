CREATE TABLE "user_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "buildNumber" TEXT,
    "osVersion" TEXT,
    "appLocale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_feedback_status_createdAt_idx" ON "user_feedback"("status", "createdAt");
CREATE INDEX "user_feedback_userId_createdAt_idx" ON "user_feedback"("userId", "createdAt");

ALTER TABLE "user_feedback"
ADD CONSTRAINT "user_feedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
