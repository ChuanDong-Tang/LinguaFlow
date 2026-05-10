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
  // 连续失败次数，用于熔断
  private consecutiveFailures = 0;
  // 熔断打开结束时间（毫秒时间戳）
  private openUntilMs = 0;

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
    const config = getRuntimeConfig();
    // 支持运行期间临时关闭
    if (!config.systemEventLogCleanupEnabled) {
      console.log("[system-event-log-cleanup] skipped: disabled by config");
      return;
    }
    if (Date.now() < this.openUntilMs) {
      console.log("[system-event-log-cleanup] skipped: circuit open", {
        openUntilMs: this.openUntilMs,
        consecutiveFailures: this.consecutiveFailures,
      });
      return;
    }

    this.running = true;
    const startedAt = Date.now();

    try {
      const { deletedCount, retentionDays, batchSize } = await this.withRetry(
        async () => {
          const lockAcquired = await this.tryAcquireLock();
          if (!lockAcquired) return { deletedCount: 0, retentionDays: 0, batchSize: 0 };

          const now = new Date();
          const retentionDays = this.options.retentionDays ?? config.systemEventLogRetentionDays;
          const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
          const createdBefore = new Date(now.getTime() - retentionMs);
          const batchSize = this.options.batchSize ?? config.systemEventLogCleanupBatchSize;
          const deletedCount = await this.deleteInBatches({ createdBefore, batchSize });
          return { deletedCount, retentionDays, batchSize };
        },
        config.systemEventLogCleanupMaxRetryAttempts,
        config.systemEventLogCleanupRetryBaseDelayMs,
        config.systemEventLogCleanupRetryMaxDelayMs
      );
      const durationMs = Date.now() - startedAt;
      this.consecutiveFailures = 0;

      console.log("[system-event-log-cleanup]", { deletedCount, retentionDays, batchSize, durationMs });
    } catch (error) {
      console.error("[system-event-log-cleanup] failed", error);
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= config.systemEventLogCleanupCircuitFailThreshold) {
        this.openUntilMs = Date.now() + config.systemEventLogCleanupCircuitOpenMs;
        await this.writeWorkerLog({
          module: "infra",
          event: "infra.worker.system_event_log_cleanup_circuit_open",
          level: "warn",
          status: "ignored",
          errorCode: "SYSTEM_EVENT_LOG_CLEANUP_CIRCUIT_OPEN",
          errorMessage: `consecutive failures=${this.consecutiveFailures}`,
          metadata: {
            openUntilMs: this.openUntilMs,
            threshold: config.systemEventLogCleanupCircuitFailThreshold,
            openMs: config.systemEventLogCleanupCircuitOpenMs,
          },
        });
      }
      await this.writeWorkerLog({
        module: "infra",
        event: "infra.worker.system_event_log_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "SYSTEM_EVENT_LOG_CLEANUP_FAILED",
        errorMessage: toErrorMessage(error),
        metadata: {
          consecutiveFailures: this.consecutiveFailures,
          openUntilMs: this.openUntilMs || null,
        },
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

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number,
    baseDelayMs: number,
    maxDelayMs: number
  ): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        const delayMs = computeBackoffMs(baseDelayMs, maxDelayMs, attempt);
        console.warn("[system-event-log-cleanup] retrying", {
          attempt,
          maxAttempts,
          delayMs,
          errorMessage: toErrorMessage(error),
        });
        await sleep(delayMs);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function computeBackoffMs(baseDelayMs: number, maxDelayMs: number, attempt: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(maxDelayMs, exponential + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
