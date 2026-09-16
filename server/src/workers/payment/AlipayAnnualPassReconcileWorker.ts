import type { PaymentOrderRepository } from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { AlipayAnnualPassService } from "../../providers/payment/alipay/AlipayAnnualPassService.js";

export class AlipayAnnualPassReconcileWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly orders: PaymentOrderRepository,
    private readonly service: AlipayAnnualPassService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { intervalMs?: number; batchSize?: number; minimumAgeMs?: number } = {},
  ) {}

  start(): void {
    if (this.timer || !this.service.isConfigured()) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 60_000);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.running || !this.service.isConfigured()) return;
    this.running = true;
    try {
      const pending = await this.orders.listPendingCreatedBefore({
        before: new Date(now.getTime() - (this.options.minimumAgeMs ?? 5_000)),
        limit: this.options.batchSize ?? 50,
        provider: "alipay",
      });
      for (const order of pending) {
        if (order.productCode !== "plus_yearly" && order.productCode !== "pro_yearly") continue;
        try {
          await this.service.queryAndApply({ userId: order.userId, orderId: order.id });
        } catch (error) {
          try {
            await this.systemEventLogRepository?.create({
              module: "payment",
              event: "payment.worker.alipay_annual_pass_reconcile_failed",
              level: "warn",
              status: "failed",
              userId: order.userId,
              errorCode: "ALIPAY_ANNUAL_PASS_RECONCILE_FAILED",
              errorMessage: error instanceof Error ? error.message : String(error),
              metadata: { orderId: order.id, productCode: order.productCode },
            });
          } catch {
            // Reconciliation must continue even when audit logging is unavailable.
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
