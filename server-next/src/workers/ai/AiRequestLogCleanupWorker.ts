import type { PrismaClient } from "@prisma/client";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export interface AiRequestLogCleanupWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  retentionDays?: number;
}

export class AiRequestLogCleanupWorker {
  private static readonly LOCK_KEY = 620053;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: AiRequestLogCleanupWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;

    const config = getRuntimeConfig();
    if (!config.aiRequestLogCleanupEnabled) {
      console.log("[ai-request-log-cleanup] disabled by config");
      return;
    }

    void this.runOnce();
    const intervalMs = this.options.intervalMs ?? config.aiRequestLogCleanupIntervalMs;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();

    try {
      const lockAcquired = await this.tryAcquireLock();
      if (!lockAcquired) return;

      const config = getRuntimeConfig();
      const retentionDays = this.options.retentionDays ?? config.aiRequestLogRetentionDays;
      const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const batchSize = this.options.batchSize ?? config.aiRequestLogCleanupBatchSize;
      const deletedCount = await this.deleteInBatches({ threshold, batchSize });
      const durationMs = Date.now() - startedAt;

      console.log("[ai-request-log-cleanup]", { deletedCount, retentionDays, batchSize, durationMs });
    } catch (error) {
      console.error("[ai-request-log-cleanup] failed", error);
      await this.writeWorkerLog({
        module: "ai",
        event: "ai.worker.ai_request_log_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "AI_REQUEST_LOG_CLEANUP_FAILED",
        errorMessage: toErrorMessage(error),
      });
    } finally {
      await this.releaseLock();
      this.running = false;
    }
  }

  private async deleteInBatches(input: { threshold: Date; batchSize: number }): Promise<number> {
    let totalDeleted = 0;
    while (true) {
      const rows = await this.prisma.aiRequestLog.findMany({
        where: { createdAt: { lt: input.threshold } },
        select: { id: true },
        take: input.batchSize,
      });
      if (!rows.length) return totalDeleted;

      const deleted = await this.prisma.aiRequestLog.deleteMany({
        where: { id: { in: rows.map((item) => item.id) } },
      });
      totalDeleted += deleted.count;
      if (rows.length < input.batchSize) return totalDeleted;
    }
  }

  private async tryAcquireLock(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${AiRequestLogCleanupWorker.LOCK_KEY})
      `;
      return rows[0]?.pg_try_advisory_lock === true;
    } catch (error) {
      console.error("[ai-request-log-cleanup] acquire advisory lock failed", error);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${AiRequestLogCleanupWorker.LOCK_KEY})
      `;
    } catch (error) {
      console.error("[ai-request-log-cleanup] release advisory lock failed", error);
    }
  }

  private async writeWorkerLog(input: {
    module: string;
    event: string;
    level: "info" | "warn" | "error";
    status: "success" | "failed" | "ignored";
    userId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: unknown;
  }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: input.module,
        event: input.event,
        level: input.level,
        status: input.status,
        userId: input.userId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      console.error("[ai-request-log-cleanup] write system_event_log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
