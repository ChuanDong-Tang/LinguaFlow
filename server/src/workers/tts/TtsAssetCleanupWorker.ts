import type { PrismaClient } from "@prisma/client";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export interface TtsAssetCleanupWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  failedRetentionDays?: number;
}

export class TtsAssetCleanupWorker {
  private static readonly LOCK_KEY = 620058;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: TtsAssetCleanupWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;
    const config = getRuntimeConfig();
    if (!config.ttsAssetCleanupEnabled) {
      console.log("[tts-asset-cleanup] disabled by config");
      return;
    }

    const intervalMs = this.options.intervalMs ?? config.ttsAssetCleanupIntervalMs;
    void this.runOnce();
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
    const startedAt = Date.now();
    if (!config.ttsAssetCleanupEnabled) {
      await this.writeRoundLog("skipped_disabled", Date.now() - startedAt, 0);
      return;
    }

    this.running = true;
    let lockAcquired = false;
    try {
      lockAcquired = await this.tryAcquireLock();
      if (!lockAcquired) {
        await this.writeRoundLog("skipped_lock_miss", Date.now() - startedAt, 0);
        return;
      }

      const failedRetentionDays = this.options.failedRetentionDays ?? config.ttsFailedAssetRetentionDays;
      const threshold = new Date(Date.now() - failedRetentionDays * 24 * 60 * 60 * 1000);
      const batchSize = this.options.batchSize ?? config.ttsAssetCleanupBatchSize;
      const deletedRows = await this.deleteFailedInBatches({ threshold, batchSize });

      await this.writeRoundLog(
        deletedRows > 0 ? "success" : "success_empty",
        Date.now() - startedAt,
        deletedRows,
        { failedRetentionDays, batchSize }
      );
    } catch (error) {
      await this.writeWorkerLog({
        event: "tts.worker.tts_asset_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "TTS_ASSET_CLEANUP_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await this.writeRoundLog("failed", Date.now() - startedAt, 0);
    } finally {
      if (lockAcquired) await this.releaseLock();
      this.running = false;
    }
  }

  private async deleteFailedInBatches(input: { threshold: Date; batchSize: number }): Promise<number> {
    let totalDeleted = 0;
    while (true) {
      const rows = await this.prisma.ttsAsset.findMany({
        where: {
          status: "failed",
          updatedAt: { lt: input.threshold },
        },
        select: { id: true },
        take: input.batchSize,
        orderBy: { updatedAt: "asc" },
      });
      if (!rows.length) return totalDeleted;
      const deleted = await this.prisma.ttsAsset.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      totalDeleted += deleted.count;
      if (rows.length < input.batchSize) return totalDeleted;
    }
  }

  private async tryAcquireLock(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${TtsAssetCleanupWorker.LOCK_KEY})
      `;
      return rows[0]?.pg_try_advisory_lock === true;
    } catch (error) {
      console.error("[tts-asset-cleanup] acquire advisory lock failed", error);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${TtsAssetCleanupWorker.LOCK_KEY})
      `;
    } catch (error) {
      console.error("[tts-asset-cleanup] release advisory lock failed", error);
    }
  }

  private async writeRoundLog(
    roundStatus: "success" | "success_empty" | "failed" | "skipped_disabled" | "skipped_lock_miss",
    durationMs: number,
    deletedRows: number,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    await this.writeWorkerLog({
      event: "tts.worker.tts_asset_cleanup_round",
      level: roundStatus === "failed" ? "error" : "info",
      status: roundStatus === "failed" ? "failed" : "success",
      metadata: {
        worker: "tts_asset_cleanup",
        status: roundStatus,
        durationMs,
        deletedRows,
        lockKey: TtsAssetCleanupWorker.LOCK_KEY,
        ...extra,
      },
    });
  }

  private async writeWorkerLog(input: {
    event: string;
    level: "info" | "warn" | "error";
    status: "success" | "failed" | "ignored";
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: unknown;
  }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: "tts",
        event: input.event,
        level: input.level,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      console.error("[tts-asset-cleanup] write system_event_log failed", error);
    }
  }
}
