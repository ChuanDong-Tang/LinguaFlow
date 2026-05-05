/** PaymentReconcileWorker：执行支付对账与补偿任务。 */

import type { PaymentOrderService } from "../../services/payment/PaymentOrderService.js";
import type { SubscriptionService } from "../../services/subscription/SubscriptionService.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export interface PaymentReconcileWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
}

export class PaymentReconcileWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly paymentOrderService: PaymentOrderService,
    private readonly subscriptionService: SubscriptionService,
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

    try {
      const result = await this.paymentOrderService.reconcilePendingOrders({
        limit: this.options.batchSize,
        onPaid: async (order) => {
          await this.subscriptionService.openOrRenewPro({
            userId: order.userId,
            sourceOrderId: order.id,
            months: 1,
          });
        },
      });

      if (result.scanned > 0) {
        console.log("[payment-reconcile]", result);
      }
    } catch (error) {
      console.error("[payment-reconcile] failed", error);
    } finally {
      this.running = false;
    }
  }
}
