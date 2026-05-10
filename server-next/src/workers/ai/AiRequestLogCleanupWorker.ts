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
  // 连续失败计数，避免异常时无限重试打爆数据库
  private consecutiveFailures = 0;
  // 熔断打开截止时间
  private openUntilMs = 0;

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
    const config = getRuntimeConfig();
    // 支持运行期间动态关闭
    if (!config.aiRequestLogCleanupEnabled) {
      console.log("[ai-request-log-cleanup] skipped: disabled by config");
      return;
    }
    if (Date.now() < this.openUntilMs) {
      console.log("[ai-request-log-cleanup] skipped: circuit open", {
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
      const durationMs = Date.now() - startedAt;
      this.consecutiveFailures = 0;

      console.log("[ai-request-log-cleanup]", { deletedCount, retentionDays, batchSize, durationMs });
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
