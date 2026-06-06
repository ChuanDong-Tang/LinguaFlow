/** PaymentReconcileWorker：执行支付对账与补偿任务。 */

import type { PaymentOrderService } from "../../services/payment/PaymentOrderService.js";
import type { BenefitGrantService } from "../../services/payment/BenefitGrantService.js";
import type { PaymentEntitlementService } from "../../services/payment/PaymentEntitlementService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { PaymentChannel } from "../../services/payment/PaymentEntitlementService.js";
import { createEntitlementGrantPayload } from "../../services/payment/EntitlementGrantSnapshot.js";

export interface PaymentReconcileWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class PaymentReconcileWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private firstIntervalDueAt = 0;

  constructor(
    private readonly paymentOrderService: PaymentOrderService,
    private readonly benefitGrantService: BenefitGrantService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: PaymentReconcileWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;

    const intervalMs = this.options.intervalMs ?? getRuntimeConfig().payment.reconcileIntervalMs;
    // 启动先跑一次，同时避免与首个周期触发重叠
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
    const startedAt = Date.now();

    try {
      const result = await this.paymentOrderService.reconcilePendingOrders({
        limit: this.options.batchSize,
        onPaid: async (order) => {
          const channel = mapProviderToChannel(order.provider);
          if (!channel) {
            await this.writeWorkerLog({
              module: "payment",
              event: "payment.worker.provider_channel_unmapped",
              level: "warn",
              status: "ignored",
              userId: order.userId,
              errorCode: "WORKER_PROVIDER_CHANNEL_UNMAPPED",
              metadata: {
                worker: "payment_reconcile",
                batchSize: this.options.batchSize ?? getRuntimeConfig().payment.reconcileBatchSize,
                lockKey: null,
                skipReason: "provider_channel_unmapped",
                orderId: order.id,
                provider: order.provider,
                providerOrderId: order.providerOrderId,
              },
            });
            return;
          }
          let grantEnqueued = false;
          try {
            try {
              await this.paymentEntitlementService.grantAfterPayment({
                userId: order.userId,
                sourceOrderId: order.id,
                productCode: "pro_monthly",
                channel,
                grantMode: "fixed_duration",
              });
            } catch (_error) {
              await this.benefitGrantService.enqueueGrant({
                userId: order.userId,
                sourceOrderId: order.id,
                productCode: "pro_monthly",
                channel,
                payload: createEntitlementGrantPayload({
                  fallbackReason: "sync_grant_failed",
                  source: "payment_reconcile_worker",
                  grant: {
                    grantMode: "fixed_duration",
                    prepaidLimit: "enforce",
                  },
                }),
              });
              grantEnqueued = true;
            }
          } catch (error) {
            await this.writeWorkerLog({
              module: "payment",
              event: "payment.worker.on_paid_failed",
              level: "error",
              status: "failed",
              userId: order.userId,
              errorCode: "WORKER_ON_PAID_FAILED",
              errorMessage: toErrorMessage(error),
              metadata: {
                worker: "payment_reconcile",
                batchSize: this.options.batchSize ?? getRuntimeConfig().payment.reconcileBatchSize,
                lockKey: null,
                skipReason: "on_paid_failed",
                orderId: order.id,
                providerOrderId: order.providerOrderId,
                retryEnqueued: grantEnqueued,
              },
            });
            console.error("[payment-reconcile] onPaid failed, skip current order", {
              orderId: order.id,
              providerOrderId: order.providerOrderId,
              retryEnqueued: grantEnqueued,
              error: toErrorMessage(error),
            });
          }
        },
      });

      const durationMs = Date.now() - startedAt;
      console.log("[payment-reconcile]", { ...result, durationMs });
    } catch (error) {
      console.error("[payment-reconcile] failed", error);
      await this.writeWorkerLog({
        module: "payment",
        event: "payment.worker.reconcile_failed",
        level: "error",
        status: "failed",
        errorCode: "WORKER_RECONCILE_FAILED",
        errorMessage: toErrorMessage(error),
        metadata: {
          worker: "payment_reconcile",
          batchSize: this.options.batchSize ?? getRuntimeConfig().payment.reconcileBatchSize,
          lockKey: null,
          skipReason: "exception",
        },
      });
    } finally {
      this.running = false;
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
      console.error("[payment-reconcile] write system_event_log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapProviderToChannel(provider: string): PaymentChannel | null {
  if (provider === "wechat") return "wechat";
  if (provider === "apple_iap") return "ios_iap";
  return null;
}
