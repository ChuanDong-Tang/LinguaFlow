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
  private static readonly LOCK_MISS_REPORT_WINDOW_MS = 5 * 60 * 1000;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // 连续失败计数，避免异常时无限重试打爆数据库
  private consecutiveFailures = 0;
  // 熔断打开截止时间
  private openUntilMs = 0;
  private lockMissCount = 0;
  private lastLockMissReportAt = 0;
  private firstIntervalDueAt = 0;

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

    const intervalMs = this.options.intervalMs ?? config.aiRequestLogCleanupIntervalMs;
    // 启动先跑一次，同时记录首个周期触发时间，避免边界重叠
    this.firstIntervalDueAt = Date.now() + intervalMs;
    void this.runOnce();
    this.timer = setInterval(() => {
      if (Date.now() < this.firstIntervalDueAt) return;
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
    const roundStartedAt = Date.now();
    let lockAcquired = false;
    // 支持运行期间动态关闭
    if (!config.aiRequestLogCleanupEnabled) {
      console.log("[ai-request-log-cleanup] skipped: disabled by config");
      await this.writeRoundLog({
        status: "skipped_disabled",
        durationMs: Date.now() - roundStartedAt,
        skipReason: "disabled_by_config",
      });
      return;
    }
    if (Date.now() < this.openUntilMs) {
      console.log("[ai-request-log-cleanup] skipped: circuit open", {
        openUntilMs: this.openUntilMs,
        consecutiveFailures: this.consecutiveFailures,
      });
      await this.writeRoundLog({
        status: "skipped_circuit_open",
        durationMs: Date.now() - roundStartedAt,
        skipReason: "circuit_open",
      });
      return;
    }

    this.running = true;

    try {
      lockAcquired = await this.tryAcquireLock();
      if (!lockAcquired) {
        this.lockMissCount += 1;
        await this.flushLockMissIfNeeded(false);
        await this.writeRoundLog({
          status: "skipped_lock_miss",
          durationMs: Date.now() - roundStartedAt,
          skipReason: "lock_not_acquired",
        });
        return;
      }

      const { deletedCount, retentionDays, batchSize } = await this.withRetry(
        async () => {
          const retentionDays = this.options.retentionDays ?? config.aiRequestLogRetentionDays;
          const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
          const batchSize = this.options.batchSize ?? config.aiRequestLogCleanupBatchSize;
          const deletedCount = await this.deleteInBatches({ threshold, batchSize });
          return { deletedCount, retentionDays, batchSize };
        },
        config.aiRequestLogCleanupMaxRetryAttempts,
        config.aiRequestLogCleanupRetryBaseDelayMs,
        config.aiRequestLogCleanupRetryMaxDelayMs
      );
      const durationMs = Date.now() - roundStartedAt;
      this.consecutiveFailures = 0;
      await this.flushLockMissIfNeeded(true);

      console.log("[ai-request-log-cleanup]", { deletedCount, retentionDays, batchSize, durationMs });
      await this.writeRoundLog({
        status: deletedCount > 0 ? "success" : "success_empty",
        durationMs,
        deletedRows: deletedCount,
        batchCount: computeBatchCount(deletedCount, batchSize),
        batchSize,
      });
    } catch (error) {
      console.error("[ai-request-log-cleanup] failed", error);
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= config.aiRequestLogCleanupCircuitFailThreshold) {
        this.openUntilMs = Date.now() + config.aiRequestLogCleanupCircuitOpenMs;
        await this.writeWorkerLog({
          module: "ai",
          event: "ai.worker.ai_request_log_cleanup_circuit_open",
          level: "warn",
          status: "ignored",
          errorCode: "AI_REQUEST_LOG_CLEANUP_CIRCUIT_OPEN",
          errorMessage: `consecutive failures=${this.consecutiveFailures}`,
          metadata: {
            openUntilMs: this.openUntilMs,
            threshold: config.aiRequestLogCleanupCircuitFailThreshold,
            openMs: config.aiRequestLogCleanupCircuitOpenMs,
          },
        });
      }
      await this.writeWorkerLog({
        module: "ai",
        event: "ai.worker.ai_request_log_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "AI_REQUEST_LOG_CLEANUP_FAILED",
        errorMessage: toErrorMessage(error),
        metadata: {
          consecutiveFailures: this.consecutiveFailures,
          openUntilMs: this.openUntilMs || null,
        },
      });
      await this.writeRoundLog({
        status: "failed",
        durationMs: Date.now() - roundStartedAt,
        skipReason: "exception",
      });
    } finally {
      if (lockAcquired) {
        await this.releaseLock();
      }
      this.running = false;
    }
  }

  private async deleteInBatches(input: { threshold: Date; batchSize: number }): Promise<number> {
    let totalDeleted = 0;
    let lastId: string | null = null;
    // 轮次快照上界：仅清理本轮开始前的历史数据，避免并发写入时分页抖动
    const createdAtUpperBound = new Date();
    while (true) {
      const rows: Array<{ id: string }> = await this.prisma.aiRequestLog.findMany({
        where: {
          createdAt: { lt: input.threshold, lte: createdAtUpperBound },
          ...(lastId
            ? {
                id: {
                  gt: lastId,
                },
              }
            : {}),
        },
        select: { id: true },
        take: input.batchSize,
        orderBy: {
          id: "asc",
        },
      });
      if (!rows.length) return totalDeleted;

      const deleted = await this.prisma.aiRequestLog.deleteMany({
        where: { id: { in: rows.map((item: { id: string }) => item.id) } },
      });
      totalDeleted += deleted.count;
      lastId = rows[rows.length - 1]?.id ?? null;
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

  private async writeRoundLog(input: {
    status: "success" | "success_empty" | "failed" | "skipped_disabled" | "skipped_circuit_open" | "skipped_lock_miss";
    durationMs: number;
    deletedRows?: number;
    batchCount?: number;
    batchSize?: number;
    skipReason?: string;
  }): Promise<void> {
    await this.writeWorkerLog({
      module: "ai",
      event: "ai.worker.ai_request_log_cleanup_round",
      level: input.status === "failed" ? "error" : "info",
      status: input.status === "failed" ? "failed" : "success",
      metadata: {
        worker: "ai_request_log_cleanup",
        status: input.status,
        durationMs: input.durationMs,
        deletedRows: input.deletedRows ?? 0,
        batchCount: input.batchCount ?? 0,
        batchSize: input.batchSize ?? null,
        skipReason: input.skipReason ?? null,
        lockKey: AiRequestLogCleanupWorker.LOCK_KEY,
        lockMissCount: this.lockMissCount,
        consecutiveFailures: this.consecutiveFailures,
        circuitOpenUntil: this.openUntilMs || null,
      },
    });
  }

  private async flushLockMissIfNeeded(force: boolean): Promise<void> {
    if (this.lockMissCount <= 0) return;
    const now = Date.now();
    if (!force && now - this.lastLockMissReportAt < AiRequestLogCleanupWorker.LOCK_MISS_REPORT_WINDOW_MS) {
      return;
    }
    this.lastLockMissReportAt = now;
    await this.writeWorkerLog({
      module: "ai",
      event: "ai.worker.ai_request_log_cleanup_lock_miss",
      level: "warn",
      status: "ignored",
      metadata: {
        worker: "ai_request_log_cleanup",
        batchSize: null,
        lockKey: AiRequestLogCleanupWorker.LOCK_KEY,
        skipReason: "lock_not_acquired",
        lockMissCount: this.lockMissCount,
        reportWindowMs: AiRequestLogCleanupWorker.LOCK_MISS_REPORT_WINDOW_MS,
      },
    });
    this.lockMissCount = 0;
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
        console.warn("[ai-request-log-cleanup] retrying", {
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

function computeBatchCount(totalRows: number, batchSize: number): number {
  if (batchSize <= 0) return 0;
  return Math.ceil(totalRows / batchSize);
}
