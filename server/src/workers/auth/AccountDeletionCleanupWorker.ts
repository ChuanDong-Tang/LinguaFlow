import type { PrismaClient } from "@prisma/client";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { TtsStorageProvider } from "../../services/tts/TtsStorageProvider.js";

export interface AccountDeletionCleanupWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class AccountDeletionCleanupWorker {
  private static readonly LOCK_KEY = 620057;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly ttsStorageProvider?: TtsStorageProvider,
    private readonly options: AccountDeletionCleanupWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;

    const config = getRuntimeConfig();
    if (!config.accountDeletionCleanupEnabled) {
      console.log("[account-deletion-cleanup] disabled by config");
      return;
    }

    const intervalMs = this.options.intervalMs ?? config.accountDeletionCleanupIntervalMs;
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
    if (!config.accountDeletionCleanupEnabled) {
      await this.writeRoundLog({
        status: "skipped_disabled",
        durationMs: Date.now() - startedAt,
        deletedUsers: 0,
        batchSize: this.options.batchSize ?? config.accountDeletionCleanupBatchSize,
      });
      return;
    }

    this.running = true;
    let lockAcquired = false;

    try {
      lockAcquired = await this.tryAcquireLock();
      if (!lockAcquired) {
        await this.writeRoundLog({
          status: "skipped_lock_miss",
          durationMs: Date.now() - startedAt,
          deletedUsers: 0,
          batchSize: this.options.batchSize ?? config.accountDeletionCleanupBatchSize,
        });
        return;
      }

      const batchSize = this.options.batchSize ?? config.accountDeletionCleanupBatchSize;
      const users = await this.prisma.user.findMany({
        where: { status: "pending_delete" },
        select: { id: true },
        orderBy: { updatedAt: "asc" },
        take: batchSize,
      });

      let deletedUsers = 0;
      for (const user of users) {
        await this.disableUserAndDeleteData(user.id);
        deletedUsers += 1;
      }

      await this.writeRoundLog({
        status: deletedUsers > 0 ? "success" : "success_empty",
        durationMs: Date.now() - startedAt,
        deletedUsers,
        batchSize,
      });
    } catch (error) {
      await this.writeWorkerLog({
        event: "auth.worker.account_deletion_cleanup_failed",
        level: "error",
        status: "failed",
        errorCode: "ACCOUNT_DELETION_CLEANUP_FAILED",
        errorMessage: toErrorMessage(error),
      });
      await this.writeRoundLog({
        status: "failed",
        durationMs: Date.now() - startedAt,
        deletedUsers: 0,
        batchSize: this.options.batchSize ?? config.accountDeletionCleanupBatchSize,
      });
    } finally {
      if (lockAcquired) await this.releaseLock();
      this.running = false;
    }
  }

  private async disableUserAndDeleteData(userId: string): Promise<void> {
    const ttsObjectKeys = await this.prisma.ttsAsset.findMany({
      where: { userId, status: "ready" },
      select: { objectKey: true },
    });
    if (this.ttsStorageProvider) {
      for (const row of ttsObjectKeys) {
        if (!row.objectKey) continue;
        await this.ttsStorageProvider.deleteObject(row.objectKey);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aiRequestLog.deleteMany({ where: { userId } });
      await tx.benefitGrant.deleteMany({ where: { userId } });
      await tx.paymentOrder.deleteMany({ where: { userId } });
      await tx.autoRenewCharge.deleteMany({ where: { userId } });
      await tx.autoRenewSubscription.deleteMany({ where: { userId } });
      await tx.appleIapAccountLink.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.entitlement.deleteMany({ where: { userId } });
      await tx.ttsRequestLog.deleteMany({ where: { userId } });
      await tx.ttsAsset.deleteMany({ where: { userId } });
      await tx.message.deleteMany({ where: { userId } });
      await tx.conversation.deleteMany({ where: { userId } });
      await tx.userSession.deleteMany({ where: { userId } });
      await tx.systemEventLog.updateMany({
        where: { userId },
        data: { userId: null },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: "disabled",
          nickname: null,
          email: null,
          phone: null,
          avatarUrl: null,
        },
      });
    });

    await this.writeWorkerLog({
      event: "auth.worker.account_deletion_user_disabled",
      level: "info",
      status: "success",
      userId,
      metadata: {
        ttsCosObjectsDeleted: this.ttsStorageProvider ? ttsObjectKeys.length : 0,
        ttsCosCleanupSkipped: !this.ttsStorageProvider,
      },
    });
  }

  private async tryAcquireLock(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
        SELECT pg_try_advisory_lock(${AccountDeletionCleanupWorker.LOCK_KEY})
      `;
      return rows[0]?.pg_try_advisory_lock === true;
    } catch (error) {
      console.error("[account-deletion-cleanup] acquire advisory lock failed", error);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${AccountDeletionCleanupWorker.LOCK_KEY})
      `;
    } catch (error) {
      console.error("[account-deletion-cleanup] release advisory lock failed", error);
    }
  }

  private async writeRoundLog(input: {
    status: "success" | "success_empty" | "failed" | "skipped_disabled" | "skipped_lock_miss";
    durationMs: number;
    deletedUsers: number;
    batchSize: number;
  }): Promise<void> {
    await this.writeWorkerLog({
      event: "auth.worker.account_deletion_cleanup_round",
      level: input.status === "failed" ? "error" : "info",
      status: input.status === "failed" ? "failed" : "success",
      metadata: {
        worker: "account_deletion_cleanup",
        status: input.status,
        durationMs: input.durationMs,
        deletedUsers: input.deletedUsers,
        batchSize: input.batchSize,
        lockKey: AccountDeletionCleanupWorker.LOCK_KEY,
      },
    });
  }

  private async writeWorkerLog(input: {
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
        module: "auth",
        event: input.event,
        level: input.level,
        status: input.status,
        userId: input.userId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      console.error("[account-deletion-cleanup] write system_event_log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
