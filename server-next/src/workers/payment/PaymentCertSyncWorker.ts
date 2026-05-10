import type { TrustedCertRepository } from "@lf/core/ports/repository/TrustedCertRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { PaymentCertSyncService } from "../../services/payment/PaymentCertSyncService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export interface PaymentCertSyncWorkerOptions {
  intervalMs?: number;
  expireWarnDays?: number;
  retentionDaysAfterExpire?: number;
}

export class PaymentCertSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly trustedCertRepository: TrustedCertRepository,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: PaymentCertSyncWorkerOptions = {}
  ) {
    this.syncService = new PaymentCertSyncService(this.trustedCertRepository);
  }
  private readonly syncService: PaymentCertSyncService;

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    const cfg = getRuntimeConfig();
    const intervalMs = this.options.intervalMs ?? cfg.paymentCertSyncIntervalMs;
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
    try {
      const now = new Date();
      await this.syncWeChat(now);
      await this.syncApple(now);
      await this.guardHealth(now);
    } catch (error) {
      await this.writeLog({
        event: "payment.cert_sync.failed",
        level: "error",
        status: "failed",
        errorCode: "CERT_SYNC_FAILED",
        errorMessage: toErrorMessage(error),
      });
    } finally {
      this.running = false;
    }
  }

  private async syncWeChat(now: Date): Promise<void> {
    const syncedCount = await this.syncService.syncWeChatPlatformCerts();

    await this.writeLog({
      event: "payment.cert_sync.wechat_synced",
      level: "info",
      status: "success",
      metadata: { serialCount: syncedCount, syncedAt: now.toISOString() },
    });
  }

  private async syncApple(now: Date): Promise<void> {
    const synced = await this.syncService.syncAppleRootCert();
    if (!synced) {
      await this.writeLog({
        event: "payment.cert_sync.apple_not_configured",
        level: "warn",
        status: "ignored",
      });
      return;
    }
    await this.writeLog({
      event: "payment.cert_sync.apple_synced",
      level: "info",
      status: "success",
      metadata: { syncedAt: now.toISOString() },
    });
  }

  private async guardHealth(now: Date): Promise<void> {
    const cfg = getRuntimeConfig();
    const warnDays = this.options.expireWarnDays ?? cfg.paymentCertExpireWarnDays;
    const retentionDays =
      this.options.retentionDaysAfterExpire ?? cfg.paymentCertRetentionDaysAfterExpire;
    const warnMs = warnDays * 24 * 60 * 60 * 1000;
    for (const provider of ["wechat", "apple"] as const) {
      const certs = await this.trustedCertRepository.listActiveByProvider(provider);
      for (const cert of certs) {
        if (!cert.notAfter) continue;
        const remainMs = cert.notAfter.getTime() - now.getTime();
        if (remainMs <= warnMs) {
          await this.writeLog({
            event: "payment.cert_health.expiring_soon",
            level: "warn",
            status: "failed",
            errorCode: "CERT_EXPIRING_SOON",
            metadata: {
              provider,
              keyId: cert.keyId,
              notAfter: cert.notAfter.toISOString(),
              remainDays: Math.floor(remainMs / (24 * 60 * 60 * 1000)),
            },
          });
        }
      }
    }
    const deleteBefore = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const deletedCount = await this.trustedCertRepository.deleteExpiredBefore({
      before: deleteBefore,
    });
    if (deletedCount > 0) {
      await this.writeLog({
        event: "payment.cert_health.expired_deleted",
        level: "info",
        status: "success",
        metadata: { deletedCount, retentionDays, deleteBefore: deleteBefore.toISOString() },
      });
    }
  }

  private async writeLog(input: {
    event: string;
    level: "info" | "warn" | "error";
    status: "success" | "failed" | "ignored";
    errorCode?: string;
    errorMessage?: string;
    metadata?: unknown;
  }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: "payment",
        event: input.event,
        level: input.level,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      console.error("[payment-cert-sync] write log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
