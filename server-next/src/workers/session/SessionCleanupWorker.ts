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
    this.running = true;
    const startedAt = Date.now();

    try {
      const lockAcquired = await this.tryAcquireLock();
      if (!lockAcquired) {
        console.log("[session-cleanup] skipped: lock not acquired");
        return;
      }

      const now = new Date();
      const config = getRuntimeConfig();
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

      const durationMs = Date.now() - startedAt;
      console.log("[session-cleanup]", {
        expiredDeleted,
        revokedDeleted,
        retentionDays,
        batchSize,
        durationMs,
      });
    } catch (error) {
      console.error("[session-cleanup] failed", error);
      await this.writeWorkerLog({
        module: "auth",
        event: "auth.worker.session_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "SESSION_CLEANUP_FAILED",
        errorMessage: toErrorMessage(error),
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
