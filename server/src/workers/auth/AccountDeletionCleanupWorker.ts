import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { TtsStorageProvider } from "../../services/tts/TtsStorageProvider.js";
import type { GooglePlayBillingService } from "../../providers/payment/google/GooglePlayBillingService.js";
import type { AlipayAutoRenewService } from "../../providers/payment/alipay/AlipayAutoRenewService.js";
import type { AppleIapService } from "../../providers/payment/apple/AppleIapService.js";
import type { AccountDeletionRenewalResult } from "../../providers/payment/AccountDeletionRenewal.js";
import type { CardImageStorageProvider } from "../../providers/storage/CardImageStorageProvider.js";

export interface AccountDeletionCleanupWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  googlePlayBillingService?: GooglePlayBillingService;
  alipayAutoRenewService?: AlipayAutoRenewService;
  appleIapService?: AppleIapService;
  imageStorageProvider?: CardImageStorageProvider;
}

type AccountDeletionDeferredReason = {
  reason: string;
  provider?: "apple" | "google_play" | "alipay";
  remoteStatus?: string;
  currentPeriodEnd?: string | null;
};

type ProviderRenewalCheck = {
  provider: "apple" | "google_play" | "alipay";
  result: AccountDeletionRenewalResult;
};

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
      let deferredUsers = 0;
      let failedUsers = 0;
      for (const user of users) {
        try {
          const result = await this.disableUserAndDeleteData(user.id);
          if (result.status === "deleted") {
            deletedUsers += 1;
          } else {
            deferredUsers += 1;
            await this.writeWorkerLog({
              event: "auth.worker.account_deletion_user_deferred",
              level: "warn",
              status: "ignored",
              errorCode: "ACCOUNT_DELETION_DEFERRED",
              metadata: {
                userRef: anonymizeUserId(user.id),
                reason: result.reason.reason,
                provider: result.reason.provider ?? null,
                remoteStatus: result.reason.remoteStatus ?? null,
                currentPeriodEnd: result.reason.currentPeriodEnd ?? null,
              },
            });
          }
        } catch (error) {
          failedUsers += 1;
          await this.writeWorkerLog({
            event: "auth.worker.account_deletion_user_failed",
            level: "error",
            status: "failed",
            errorCode: toErrorCode(error),
            errorMessage: "Account deletion cleanup failed for one user",
            metadata: {
              userRef: anonymizeUserId(user.id),
              provider: error instanceof AccountDeletionProviderError ? error.provider : null,
              remoteStatus: remoteStatusFromError(error),
            },
          });
        }
      }

      await this.writeRoundLog({
        status: resolveRoundStatus({ selectedUsers: users.length, deletedUsers, deferredUsers, failedUsers }),
        durationMs: Date.now() - startedAt,
        selectedUsers: users.length,
        deletedUsers,
        deferredUsers,
        failedUsers,
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
        selectedUsers: 0,
        deletedUsers: 0,
        deferredUsers: 0,
        failedUsers: 0,
        batchSize: this.options.batchSize ?? config.accountDeletionCleanupBatchSize,
      });
    } finally {
      if (lockAcquired) await this.releaseLock();
      this.running = false;
    }
  }

  private async disableUserAndDeleteData(
    userId: string,
  ): Promise<{ status: "deleted" } | { status: "deferred"; reason: AccountDeletionDeferredReason }> {
    const renewalResults = (await Promise.all([
      this.stopGooglePlayRenewalsBeforeDeletion(userId),
      this.stopAlipayRenewalsBeforeDeletion(userId),
      this.checkAppleRenewalsBeforeDeletion(userId),
    ])).flat();
    const deferredRenewal = renewalResults.find(
      (result) => result.result.action === "deferred",
    );
    if (deferredRenewal) {
      return {
        status: "deferred",
        reason: {
          reason: deferredRenewal.result.reason ?? "provider_renewal_state_not_safe",
          provider: deferredRenewal.provider,
          remoteStatus: deferredRenewal.result.remoteStatus,
          currentPeriodEnd: deferredRenewal.result.currentPeriodEnd,
        },
      };
    }

    const currentMembership = await this.prisma.subscription.findFirst({
      where: { userId, status: "active", expiresAt: { gt: new Date() } },
      select: { expiresAt: true },
      orderBy: { expiresAt: "desc" },
    });
    if (currentMembership) {
      return {
        status: "deferred",
        reason: {
          reason: "paid_membership_period_active",
          currentPeriodEnd: currentMembership.expiresAt.toISOString(),
        },
      };
    }

    const googlePlayRenewalsStopped = renewalStoppedCount(renewalResults, "google_play");
    const alipayRenewalsStopped = renewalStoppedCount(renewalResults, "alipay");
    const appleRenewalsVerified = renewalResults.filter((item) => item.provider === "apple").length;
    const ttsObjectKeys = await this.prisma.ttsAsset.findMany({
      where: { userId, status: "ready" },
      select: { objectKey: true },
    });
    const cardSpeechObjectKeys = await this.prisma.cardSpeechAsset.findMany({
      where: { userId },
      select: { objectKey: true },
    });
    const cardImages = await this.prisma.cardImageAsset.findMany({
      where: { userId },
      select: { originalObjectKey: true, uploadObjectKey: true, thumbnailObjectKey: true },
    });
    const avatars = await this.prisma.userAvatarAsset.findMany({
      where: { userId },
      select: { originalObjectKey: true, uploadObjectKey: true, profileObjectKey: true, thumbnailObjectKey: true },
    });
    if (this.ttsStorageProvider) {
      for (const row of [...ttsObjectKeys, ...cardSpeechObjectKeys]) {
        if (!row.objectKey) continue;
        await this.ttsStorageProvider.deleteObject(row.objectKey);
      }
    }
    if (this.options.imageStorageProvider) {
      const imageKeys = new Set([
        ...cardImages.flatMap((row) => [row.originalObjectKey, row.uploadObjectKey, row.thumbnailObjectKey]),
        ...avatars.flatMap((row) => [row.originalObjectKey, row.uploadObjectKey, row.profileObjectKey, row.thumbnailObjectKey]),
      ].filter((key): key is string => Boolean(key)));
      for (const key of imageKeys) await this.options.imageStorageProvider.delete(key);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aiRequestLog.deleteMany({ where: { userId } });
      await tx.benefitGrant.deleteMany({ where: { userId } });
      await tx.paymentOrder.deleteMany({ where: { userId } });
      await tx.autoRenewCharge.deleteMany({ where: { userId } });
      await tx.autoRenewSubscription.deleteMany({ where: { userId } });
      await tx.alipayAccountLink.deleteMany({ where: { userId } });
      await tx.appleIapAccountLink.deleteMany({ where: { userId } });
      await tx.googlePlayAccountLink.deleteMany({ where: { userId } });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.entitlement.deleteMany({ where: { userId } });
      await tx.ttsRequestLog.deleteMany({ where: { userId } });
      await tx.ttsAsset.deleteMany({ where: { userId } });
      await tx.cardSpeechAsset.deleteMany({ where: { userId } });
      await tx.cardPracticeState.deleteMany({ where: { userId } });
      await tx.cardImageAsset.deleteMany({ where: { userId } });
      await tx.recallSession.deleteMany({ where: { userId } });
      await tx.cardEnrichmentJob.deleteMany({ where: { userId } });
      await tx.cardEmbedding.deleteMany({ where: { userId } });
      await tx.phrase.deleteMany({ where: { userId } });
      await tx.cardCollection.deleteMany({ where: { userId } });
      await tx.card.deleteMany({ where: { userId } });
      await tx.userProfile.deleteMany({ where: { userId } });
      await tx.userAvatarAsset.deleteMany({ where: { userId } });
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
      metadata: {
        userRef: anonymizeUserId(userId),
        ttsCosObjectsDeleted: this.ttsStorageProvider ? ttsObjectKeys.length + cardSpeechObjectKeys.length : 0,
        ttsCosCleanupSkipped: !this.ttsStorageProvider,
        imageCosObjectsDeleted: this.options.imageStorageProvider
          ? cardImages.length + avatars.length
          : 0,
        imageCosCleanupSkipped: !this.options.imageStorageProvider,
        googlePlayRenewalsStopped,
        alipayRenewalsStopped,
        appleRenewalsVerified,
        renewalChecks: renewalResults.map((item) => ({
          provider: item.provider,
          action: item.result.action,
          remoteStatus: item.result.remoteStatus,
          reason: item.result.reason ?? null,
        })),
      },
    });
    return { status: "deleted" };
  }

  private async stopGooglePlayRenewalsBeforeDeletion(userId: string) {
    const subscriptions = await this.prisma.autoRenewSubscription.findMany({
      where: {
        userId,
        provider: "google_play",
      },
      select: { providerAgreementId: true },
      orderBy: { updatedAt: "desc" },
    });
    if (subscriptions.length === 0) return [];
    try {
      const service = this.options.googlePlayBillingService;
      if (!service) throw new Error("GOOGLE_PLAY_ACCOUNT_DELETION_CANCEL_SERVICE_NOT_CONFIGURED");
      const results: ProviderRenewalCheck[] = [];
      for (const subscription of subscriptions) {
        results.push({
          provider: "google_play",
          result: await service.stopSubscriptionRenewalForAccountDeletion(subscription.providerAgreementId),
        });
      }
      return results;
    } catch (error) {
      throw new AccountDeletionProviderError("google_play", error);
    }
  }

  private async stopAlipayRenewalsBeforeDeletion(userId: string) {
    const subscriptions = await this.prisma.autoRenewSubscription.findMany({
      where: {
        userId,
        provider: "alipay",
      },
      select: { providerAgreementId: true },
      orderBy: { updatedAt: "desc" },
    });
    if (subscriptions.length === 0) return [];
    try {
      const service = this.options.alipayAutoRenewService;
      if (!service) throw new Error("ALIPAY_ACCOUNT_DELETION_CANCEL_SERVICE_NOT_CONFIGURED");
      const results: ProviderRenewalCheck[] = [];
      for (const subscription of subscriptions) {
        results.push({
          provider: "alipay",
          result: await service.stopSubscriptionRenewalForAccountDeletion(subscription.providerAgreementId),
        });
      }
      return results;
    } catch (error) {
      throw new AccountDeletionProviderError("alipay", error);
    }
  }

  private async checkAppleRenewalsBeforeDeletion(userId: string) {
    const subscriptions = await this.prisma.autoRenewSubscription.findMany({
      where: { userId, provider: "apple" },
      select: { providerAgreementId: true },
      orderBy: { updatedAt: "desc" },
    });
    if (subscriptions.length === 0) return [];
    try {
      const service = this.options.appleIapService;
      if (!service) throw new Error("APPLE_ACCOUNT_DELETION_SERVICE_NOT_CONFIGURED");
      const results: ProviderRenewalCheck[] = [];
      for (const subscription of subscriptions) {
        results.push({
          provider: "apple",
          result: await service.checkRenewalForAccountDeletion(subscription.providerAgreementId),
        });
      }
      return results;
    } catch (error) {
      throw new AccountDeletionProviderError("apple", error);
    }
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
    status: "success" | "success_empty" | "failed" | "partial_failure" | "deferred" | "partial_deferred" | "skipped_disabled" | "skipped_lock_miss";
    durationMs: number;
    selectedUsers?: number;
    deletedUsers: number;
    deferredUsers?: number;
    failedUsers?: number;
    batchSize: number;
  }): Promise<void> {
    const failed = input.status === "failed" || input.status === "partial_failure";
    const deferred = input.status === "deferred" || input.status === "partial_deferred";
    await this.writeWorkerLog({
      event: "auth.worker.account_deletion_cleanup_round",
      level: failed ? "error" : deferred ? "warn" : "info",
      status: failed ? "failed" : deferred ? "ignored" : "success",
      metadata: {
        worker: "account_deletion_cleanup",
        status: input.status,
        durationMs: input.durationMs,
        selectedUsers: input.selectedUsers ?? 0,
        deletedUsers: input.deletedUsers,
        deferredUsers: input.deferredUsers ?? 0,
        failedUsers: input.failedUsers ?? 0,
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

class AccountDeletionProviderError extends Error {
  constructor(
    readonly provider: "apple" | "google_play" | "alipay",
    readonly originalError: unknown,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
  }
}

function toErrorCode(error: unknown): string {
  const original = error instanceof AccountDeletionProviderError ? error.originalError : error;
  if (original && typeof original === "object" && "code" in original) {
    const code = String((original as { code?: unknown }).code ?? "").trim();
    if (code) return code.slice(0, 80);
  }
  const message = original instanceof Error ? original.message : String(original);
  const code = message.match(/[A-Z][A-Z0-9_]{2,79}/)?.[0];
  return code ?? "ACCOUNT_DELETION_USER_FAILED";
}

function remoteStatusFromError(error: unknown): string | null {
  const original = error instanceof AccountDeletionProviderError ? error.originalError : error;
  if (!original || typeof original !== "object" || !("remoteStatus" in original)) return null;
  const status = String((original as { remoteStatus?: unknown }).remoteStatus ?? "").trim();
  return status ? status.slice(0, 80) : null;
}

function anonymizeUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function renewalStoppedCount(
  results: ProviderRenewalCheck[],
  provider: string,
): number {
  return results.filter((item) => item.provider === provider && item.result.action === "cancelled").length;
}

export function resolveRoundStatus(input: {
  selectedUsers: number;
  deletedUsers: number;
  deferredUsers: number;
  failedUsers: number;
}): "success" | "success_empty" | "failed" | "partial_failure" | "deferred" | "partial_deferred" {
  if (input.failedUsers > 0) return input.deletedUsers > 0 ? "partial_failure" : "failed";
  if (input.deferredUsers > 0) return input.deletedUsers > 0 ? "partial_deferred" : "deferred";
  return input.selectedUsers === 0 ? "success_empty" : "success";
}
