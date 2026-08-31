import type { PrismaClient } from "@prisma/client";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { getRedisClient } from "../../infrastructure/redis/redisClient.js";
import type { AlipayAutoRenewService } from "../../providers/payment/alipay/AlipayAutoRenewService.js";

export class AlipaySubscriptionReconcileWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cursorId: string | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly alipayAutoRenewService: AlipayAutoRenewService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
  ) {}

  start(): void {
    if (this.timer) return;
    const config = getRuntimeConfig().payment.alipayAutoRenew;
    if (!config.enabled || !this.alipayAutoRenewService.isConfigured()) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), config.reconcileIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const config = getRuntimeConfig().payment.alipayAutoRenew;
    const lockValue = `${process.pid}:${Date.now()}`;
    try {
      const redis = getRedisClient();
      if (redis) {
        const locked = await (redis.set as any)(
          "lock:alipay_subscription_reconcile:run",
          lockValue,
          "NX",
          "PX",
          Math.max(config.reconcileIntervalMs - 1000, 30_000),
        );
        if (locked !== "OK") return;
      }

      const rows = await this.prisma.autoRenewSubscription.findMany({
        where: {
          provider: "alipay",
          status: { in: ["pending", "active", "billing_retry", "paused"] },
          ...(this.cursorId ? { id: { gt: this.cursorId } } : {}),
        },
        select: { id: true, userId: true, providerAgreementId: true },
        orderBy: { id: "asc" },
        take: config.reconcileBatchSize,
      });

      const result = { checked: rows.length, changed: 0, unchanged: 0, failed: 0 };
      for (const row of rows) {
        try {
          const reconciled = await this.alipayAutoRenewService.reconcileAlipayAutoRenewSubscription(
            row.providerAgreementId,
          );
          if (reconciled.status === "checked" && reconciled.action !== "unchanged") result.changed += 1;
          else result.unchanged += 1;
        } catch (error) {
          result.failed += 1;
          await this.writeLog({
            event: "payment.alipay.autorenew.worker_item_failed",
            status: "failed",
            level: "warn",
            userId: row.userId,
            errorCode: "ALIPAY_AUTORENEW_RECONCILE_ITEM_FAILED",
            errorMessage: error instanceof Error ? error.message : String(error),
            metadata: { autoRenewSubscriptionId: row.id },
          });
        }
      }
      this.cursorId = rows.length < config.reconcileBatchSize ? null : rows.at(-1)?.id ?? null;

      if (rows.length > 0 || result.failed > 0) {
        console.log("[alipay-subscription-reconcile]", result);
        await this.writeLog({
          event: "payment.alipay.autorenew.worker_reconciled",
          status: result.failed > 0 ? "failed" : "success",
          level: result.failed > 0 ? "warn" : "info",
          errorCode: result.failed > 0 ? "ALIPAY_AUTORENEW_RECONCILE_PARTIAL_FAILED" : null,
          metadata: { result, batchSize: config.reconcileBatchSize },
        });
      }
    } catch (error) {
      await this.writeLog({
        event: "payment.alipay.autorenew.worker_failed",
        status: "failed",
        level: "error",
        errorCode: "ALIPAY_AUTORENEW_RECONCILE_WORKER_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await this.releaseLock(lockValue);
      this.running = false;
    }
  }

  private async releaseLock(lockValue: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.eval(
      `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
      1,
      "lock:alipay_subscription_reconcile:run",
      lockValue,
    );
  }

  private async writeLog(input: {
    event: string;
    status: "success" | "failed";
    level: "info" | "warn" | "error";
    userId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: unknown;
  }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: "payment",
        event: input.event,
        status: input.status,
        level: input.level,
        userId: input.userId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      console.error("[alipay-subscription-reconcile] write system event log failed", error);
    }
  }
}
