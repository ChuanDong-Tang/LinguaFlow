-- CreateEnum
CREATE TYPE "SystemEventLogLevel" AS ENUM ('info', 'warn', 'error');

-- CreateEnum
CREATE TYPE "SystemEventLogStatus" AS ENUM ('success', 'failed', 'ignored');

-- CreateTable
CREATE TABLE "system_event_logs" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "userId" TEXT,
    "module" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "level" "SystemEventLogLevel" NOT NULL,
    "status" "SystemEventLogStatus" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_event_logs_requestId_idx" ON "system_event_logs"("requestId");

-- CreateIndex
CREATE INDEX "system_event_logs_userId_createdAt_idx" ON "system_event_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "system_event_logs_module_event_createdAt_idx" ON "system_event_logs"("module", "event", "createdAt");

-- CreateIndex
CREATE INDEX "system_event_logs_level_createdAt_idx" ON "system_event_logs"("level", "createdAt");

-- CreateIndex
CREATE INDEX "system_event_logs_status_createdAt_idx" ON "system_event_logs"("status", "createdAt");
