import type { PrismaClient } from "@prisma/client";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export interface SystemEventLogCleanupWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  retentionDays?: number;
}

export class SystemEventLogCleanupWorker {
  private static readonly LOCK_KEY = 620052;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: SystemEventLogCleanupWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;

    const config = getRuntimeConfig();
    if (!config.systemEventLogCleanupEnabled) {
      console.log("[system-event-log-cleanup] disabled by config");
      return;
    }

    void this.runOnce();
    const intervalMs = this.options.intervalMs ?? config.systemEventLogCleanupIntervalMs;
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

      const now = new Date();
      const config = getRuntimeConfig();
      const retentionDays = this.options.retentionDays ?? config.systemEventLogRetentionDays;
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      const createdBefore = new Date(now.getTime() - retentionMs);
      const batchSize = this.options.batchSize ?? config.systemEventLogCleanupBatchSize;

      const deletedCount = await this.deleteInBatches({ createdBefore, batchSize });
      const durationMs = Date.now() - startedAt;

      console.log("[system-event-log-cleanup]", { deletedCount, retentionDays, batchSize, durationMs });
    } catch (error) {
      console.error("[system-event-log-cleanup] failed", error);
      await this.writeWorkerLog({
        module: "infra",
        event: "infra.worker.system_event_log_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "SYSTEM_EVENT_LOG_CLEANUP_FAILED",
        errorMessage: toErrorMessage(error),
      });
    } finally {
      await this.releaseLock();
      this.running = false;
    }
  }

  private async deleteInBatches(input: { createdBefore: Date; batchSize: number }): Promise<number> {
    let totalDeleted = 0;
    while (true) {
      const rows = await this.prisma.systemEventLog.findMany({
        where: {
          createdAt: { lt: input.createdBefore },
        },
        select: { id: true },
        take: input.batchSize,
      });
      if (!rows.length) return totalDeleted;

      const deleted = await this.prisma.systemEventLog.deleteMany({
        where: { id: { in: rows.map((item) => item.id) } },
      });
      totalDeleted += deleted.count;
      if (rows.length < input.batchSize) return totalDeleted;
    }
  }

  private async tryAcquireLock(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${SystemEventLogCleanupWorker.LOCK_KEY})
      `;
      return rows[0]?.pg_try_advisory_lock === true;
    } catch (error) {
      console.error("[system-event-log-cleanup] acquire advisory lock failed", error);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${SystemEventLogCleanupWorker.LOCK_KEY})
      `;
    } catch (error) {
      console.error("[system-event-log-cleanup] release advisory lock failed", error);
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
      console.error("[system-event-log-cleanup] write system_event_log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
