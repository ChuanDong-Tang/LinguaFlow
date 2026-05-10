import type { PrismaClient } from "@prisma/client";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export interface SessionCleanupWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  revokedRetentionDays?: number;
}

export class SessionCleanupWorker {
  private static readonly LOCK_KEY = 620051;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  // 连续失败计数：用于触发熔断，避免数据库抖动时持续打压
  private consecutiveFailures = 0;
  // 熔断打开到期时间戳（毫秒）。now < openUntilMs 代表本轮直接跳过
  private openUntilMs = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: SessionCleanupWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;

    const config = getRuntimeConfig();
    if (!config.sessionCleanupEnabled) {
      console.log("[session-cleanup] disabled by config");
      return;
    }

    void this.runOnce();
    const intervalMs = this.options.intervalMs ?? config.sessionCleanupIntervalMs;
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
    // 每轮动态读取开关，支持“临时禁用”后立即生效
    if (!config.sessionCleanupEnabled) {
      console.log("[session-cleanup] skipped: disabled by config");
      return;
    }
    // 熔断打开期间直接跳过，防止 delete/deleteMany 持续暴增
    if (Date.now() < this.openUntilMs) {
      console.log("[session-cleanup] skipped: circuit open", {
        openUntilMs: this.openUntilMs,
        consecutiveFailures: this.consecutiveFailures,
      });
      return;
    }

    this.running = true;
    const startedAt = Date.now();

    try {
      const { expiredDeleted, revokedDeleted, retentionDays, batchSize } = await this.withRetry(
        async () => {
          const lockAcquired = await this.tryAcquireLock();
          if (!lockAcquired) {
            console.log("[session-cleanup] skipped: lock not acquired");
            return { expiredDeleted: 0, revokedDeleted: 0, retentionDays: 0, batchSize: 0 };
          }

          const now = new Date();
          const retentionDays = this.options.revokedRetentionDays ?? config.sessionRevokedRetentionDays;
          const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
          const revokedBefore = new Date(now.getTime() - retentionMs);
          const batchSize = this.options.batchSize ?? config.sessionCleanupBatchSize;

          const expiredDeleted = await this.deleteInBatches({
            where: {
              expiresAt: {
                lt: now,
              },
            },
            batchSize,
          });

          const revokedDeleted = await this.deleteInBatches({
            where: {
              revokedAt: {
                not: null,
                lt: revokedBefore,
              },
              expiresAt: {
                gte: now,
              },
            },
            batchSize,
          });
          return { expiredDeleted, revokedDeleted, retentionDays, batchSize };
        },
        config.sessionCleanupMaxRetryAttempts,
        config.sessionCleanupRetryBaseDelayMs,
        config.sessionCleanupRetryMaxDelayMs
      );

      const durationMs = Date.now() - startedAt;
      this.consecutiveFailures = 0;
      console.log("[session-cleanup]", {
        expiredDeleted,
        revokedDeleted,
        retentionDays,
        batchSize,
        durationMs,
      });
    } catch (error) {
      console.error("[session-cleanup] failed", error);
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= config.sessionCleanupCircuitFailThreshold) {
        // 连续失败达到阈值：打开熔断窗口，后续轮次先跳过
        this.openUntilMs = Date.now() + config.sessionCleanupCircuitOpenMs;
        await this.writeWorkerLog({
          module: "auth",
          event: "auth.worker.session_cleanup_circuit_open",
          level: "warn",
          status: "ignored",
          errorCode: "SESSION_CLEANUP_CIRCUIT_OPEN",
          errorMessage: `consecutive failures=${this.consecutiveFailures}`,
          metadata: {
            openUntilMs: this.openUntilMs,
            threshold: config.sessionCleanupCircuitFailThreshold,
            openMs: config.sessionCleanupCircuitOpenMs,
          },
        });
      }
      await this.writeWorkerLog({
        module: "auth",
        event: "auth.worker.session_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "SESSION_CLEANUP_FAILED",
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

  private async deleteInBatches(input: {
    where: {
      expiresAt?: { lt?: Date; gte?: Date };
      revokedAt?: { not?: null; lt?: Date };
    };
    batchSize: number;
  }): Promise<number> {
    let totalDeleted = 0;

    while (true) {
      const rows = await this.prisma.userSession.findMany({
        where: input.where,
        select: { id: true },
        take: input.batchSize,
      });
      if (!rows.length) return totalDeleted;

      const deleted = await this.prisma.userSession.deleteMany({
        where: {
          id: {
            in: rows.map((item) => item.id),
          },
        },
      });
      totalDeleted += deleted.count;

      if (rows.length < input.batchSize) return totalDeleted;
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
      console.error("[session-cleanup] write system_event_log failed", error);
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
        console.warn("[session-cleanup] retrying", {
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

  private async tryAcquireLock(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${SessionCleanupWorker.LOCK_KEY})
      `;
      return rows[0]?.pg_try_advisory_lock === true;
    } catch (error) {
      console.error("[session-cleanup] acquire advisory lock failed", error);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${SessionCleanupWorker.LOCK_KEY})
      `;
    } catch (error) {
      console.error("[session-cleanup] release advisory lock failed", error);
    }
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
