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
  private firstIntervalDueAt = 0;

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
    const cfg = getRuntimeConfig();
    const intervalMs = this.options.intervalMs ?? cfg.payment.certSyncIntervalMs;
    // 启动先跑一次，同时避免与首个周期重叠
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
    this.running = true;
    try {
      const now = new Date();
      const cfg = getRuntimeConfig();
      if (cfg.payment.wechatPayEnabled) {
        await this.syncWeChat(now);
      }
      if (cfg.payment.appleIap.enabled) {
        await this.syncApple(now);
      }
      await this.guardHealth(now);
    } catch (error) {
      await this.writeLog({
        event: "payment.worker.cert_sync_failed",
        level: "error",
        status: "failed",
        errorCode: "CERT_SYNC_FAILED",
        errorMessage: toErrorMessage(error),
        metadata: {
          worker: "payment_cert_sync",
          batchSize: null,
          lockKey: null,
          skipReason: "exception",
        },
      });
    } finally {
      this.running = false;
    }
  }

  private async syncWeChat(now: Date): Promise<void> {
    const syncedCount = await this.syncService.syncWeChatPlatformCerts();

    await this.writeLog({
      event: "payment.worker.cert_sync_wechat_synced",
      level: "info",
      status: "success",
      metadata: {
        worker: "payment_cert_sync",
        batchSize: null,
        lockKey: null,
        skipReason: null,
        serialCount: syncedCount,
        syncedAt: now.toISOString(),
      },
    });
  }

  private async syncApple(now: Date): Promise<void> {
    const synced = await this.syncService.syncAppleRootCert();
    if (!synced) {
      return;
    }
    await this.writeLog({
      event: "payment.worker.cert_sync_apple_synced",
      level: "info",
      status: "success",
      metadata: {
        worker: "payment_cert_sync",
        batchSize: null,
        lockKey: null,
        skipReason: null,
        syncedAt: now.toISOString(),
      },
    });
  }

  private async guardHealth(now: Date): Promise<void> {
    const cfg = getRuntimeConfig();
    const warnDays = this.options.expireWarnDays ?? cfg.payment.certExpireWarnDays;
    const retentionDays =
      this.options.retentionDaysAfterExpire ?? cfg.payment.certRetentionDaysAfterExpire;
    const warnMs = warnDays * 24 * 60 * 60 * 1000;
    const providers = getEnabledCertProviders();
    for (const provider of providers) {
      const certs = await this.trustedCertRepository.listActiveByProvider(provider);
      for (const cert of certs) {
        if (!cert.notAfter) continue;
        const remainMs = cert.notAfter.getTime() - now.getTime();
        if (remainMs <= warnMs) {
          await this.writeLog({
            event: "payment.worker.cert_health_expiring_soon",
            level: "warn",
            status: "failed",
            errorCode: "CERT_EXPIRING_SOON",
            metadata: {
              worker: "payment_cert_sync",
              batchSize: null,
              lockKey: null,
              skipReason: "cert_expiring_soon",
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
        event: "payment.worker.cert_health_expired_deleted",
        level: "info",
        status: "success",
        metadata: {
          worker: "payment_cert_sync",
          batchSize: null,
          lockKey: null,
          skipReason: null,
          deletedCount,
          retentionDays,
          deleteBefore: deleteBefore.toISOString(),
        },
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

function getEnabledCertProviders(): Array<"wechat" | "apple"> {
  const cfg = getRuntimeConfig();
  const providers: Array<"wechat" | "apple"> = [];
  if (cfg.payment.wechatPayEnabled) providers.push("wechat");
  if (cfg.payment.appleIap.enabled) providers.push("apple");
  return providers;
}
