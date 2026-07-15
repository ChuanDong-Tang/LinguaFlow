import type { PrismaClient } from "@prisma/client";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { getRedisClient } from "../../infrastructure/redis/redisClient.js";
import type { GooglePlayBillingService } from "../../providers/payment/google/GooglePlayBillingService.js";

export interface GooglePlayAcknowledgeWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class GooglePlayAcknowledgeWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly googlePlayBillingService: GooglePlayBillingService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: GooglePlayAcknowledgeWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;
    const runtime = getRuntimeConfig();
    if (!runtime.payment.googlePlayBilling.enabled) return;

    const intervalMs = this.options.intervalMs ?? runtime.payment.reconcileIntervalMs;
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

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    const lockValue = `${process.pid}:${Date.now()}`;
    try {
      const runtime = getRuntimeConfig();
      const intervalMs = this.options.intervalMs ?? runtime.payment.reconcileIntervalMs;
      const redis = getRedisClient();
      if (redis) {
        const locked = await (redis.set as any)(
          "lock:google_play_acknowledge:run",
          lockValue,
          "NX",
          "PX",
          Math.max(intervalMs - 1000, 30_000)
        );
        if (locked !== "OK") return;
      }

      const batchSize = this.options.batchSize ?? runtime.payment.reconcileBatchSize;
      const before = new Date(now.getTime() - runtime.payment.reconcileGraceMs);
      const orders = await this.prisma.paymentOrder.findMany({
        where: {
          provider: "google_play_iap",
          status: "paid",
          createdAt: { lt: before },
          metadata: {
            path: ["googlePlay", "acknowledgementState"],
            equals: "ACKNOWLEDGEMENT_STATE_PENDING",
          },
        },
        select: { id: true, userId: true, providerOrderId: true },
        orderBy: { updatedAt: "asc" },
        take: batchSize,
      });

      let acknowledged = 0;
      let pending = 0;
      let skipped = 0;
      let failed = 0;
      for (const order of orders) {
        try {
          const status = await this.googlePlayBillingService.reconcilePendingAcknowledgementOrder(order.id);
          if (status === "acknowledged") {
            acknowledged += 1;
          } else if (status === "pending") {
            pending += 1;
          } else {
            skipped += 1;
          }
        } catch (error) {
          failed += 1;
          await this.writeWorkerLog({
            event: "payment.google_play_ack.worker_order_failed",
            level: "warn",
            status: "failed",
            userId: order.userId,
            errorCode: "GOOGLE_PLAY_ACK_ORDER_FAILED",
            errorMessage: toErrorMessage(error),
            metadata: {
              worker: "google_play_acknowledge",
              orderId: order.id,
              providerOrderId: order.providerOrderId,
            },
          });
        }
      }

      if (orders.length > 0 || failed > 0) {
        const result = { checked: orders.length, acknowledged, pending, skipped, failed };
        console.log("[google-play-acknowledge]", result);
        await this.writeWorkerLog({
          event: "payment.google_play_ack.worker_reconciled",
          level: failed > 0 ? "warn" : "info",
          status: failed > 0 ? "failed" : "success",
          errorCode: failed > 0 ? "GOOGLE_PLAY_ACK_RECONCILE_PARTIAL_FAILED" : null,
          metadata: {
            worker: "google_play_acknowledge",
            batchSize,
            result,
          },
        });
      }
    } catch (error) {
      console.error("[google-play-acknowledge] failed", error);
      await this.writeWorkerLog({
        event: "payment.google_play_ack.worker_failed",
        level: "error",
        status: "failed",
        errorCode: "GOOGLE_PLAY_ACK_WORKER_FAILED",
        errorMessage: toErrorMessage(error),
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
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
      `,
      1,
      "lock:google_play_acknowledge:run",
      lockValue
    );
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
        module: "payment",
        event: input.event,
        level: input.level,
        status: input.status,
        userId: input.userId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      console.error("[google-play-acknowledge] write system_event_log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
