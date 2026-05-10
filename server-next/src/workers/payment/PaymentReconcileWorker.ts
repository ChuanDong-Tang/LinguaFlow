/** PaymentReconcileWorker：执行支付对账与补偿任务。 */

import type { PaymentOrderService } from "../../services/payment/PaymentOrderService.js";
import type { BenefitGrantService } from "../../services/payment/BenefitGrantService.js";
import type { PaymentEntitlementService } from "../../services/payment/PaymentEntitlementService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export interface PaymentReconcileWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class PaymentReconcileWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly paymentOrderService: PaymentOrderService,
    private readonly benefitGrantService: BenefitGrantService,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: PaymentReconcileWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;

    void this.runOnce();
    const intervalMs = this.options.intervalMs ?? getRuntimeConfig().paymentReconcileIntervalMs;
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
      const result = await this.paymentOrderService.reconcilePendingOrders({
        limit: this.options.batchSize,
        onPaid: async (order) => {
          let grantEnqueued = false;
          try {
            try {
              await this.paymentEntitlementService.grantAfterPayment({
                userId: order.userId,
                sourceOrderId: order.id,
                productCode: "pro_monthly",
                channel: "wechat",
              });
            } catch (_error) {
              await this.benefitGrantService.enqueueGrant({
                userId: order.userId,
                sourceOrderId: order.id,
                productCode: "pro_monthly",
                channel: "wechat",
                payload: { fallbackReason: "sync_grant_failed", source: "payment_reconcile_worker" },
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
