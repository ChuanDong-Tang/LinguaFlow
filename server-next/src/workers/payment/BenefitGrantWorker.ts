import type { BenefitGrantRepository } from "@lf/core/ports/repository/BenefitGrantRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { PaymentEntitlementService } from "../../services/payment/PaymentEntitlementService.js";

export interface BenefitGrantWorkerOptions {
  intervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
}

export class BenefitGrantWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly benefitGrantRepository: BenefitGrantRepository,
    private readonly paymentEntitlementService: PaymentEntitlementService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: BenefitGrantWorkerOptions = {}
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    const intervalMs = this.options.intervalMs ?? getRuntimeConfig().paymentReconcileIntervalMs;
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const config = getRuntimeConfig();
      const batchSize = this.options.batchSize ?? config.paymentReconcileBatchSize;
      const maxAttempts = this.options.maxAttempts ?? config.benefitGrantMaxAttempts;
      const retryEnabled = config.benefitGrantRetryEnabled;
      const backoffMaxMs = config.benefitGrantBackoffMaxMs;
      const grants = await this.benefitGrantRepository.leasePending({ now, limit: batchSize });

      for (const grant of grants) {
        try {
          await this.paymentEntitlementService.grantAfterPayment({
            userId: grant.userId,
            sourceOrderId: grant.sourceOrderId,
            productCode: grant.productCode,
            channel: grant.channel,
          });
          await this.benefitGrantRepository.markSuccess(grant.id);
        } catch (error) {
          const message = toErrorMessage(error);
          if (!retryEnabled || grant.attemptCount >= maxAttempts) {
            await this.benefitGrantRepository.markFailedTerminal({
              id: grant.id,
              errorCode: retryEnabled
                ? "BENEFIT_GRANT_MAX_RETRY_EXCEEDED"
                : "BENEFIT_GRANT_RETRY_DISABLED",
              errorMessage: message,
            });
          } else {
            const backoffMs = Math.min(
              backoffMaxMs,
              Math.pow(2, Math.max(0, grant.attemptCount - 1)) * 1_000
            );
            await this.benefitGrantRepository.markFailedRetryable({
              id: grant.id,
              errorCode: "BENEFIT_GRANT_RETRYABLE_FAILED",
              errorMessage: message,
              nextRetryAt: new Date(now.getTime() + backoffMs),
            });
          }

          await this.writeWorkerLog({
            module: "payment",
            event: "payment.worker.benefit_grant_failed",
            level: "error",
            status: "failed",
            userId: grant.userId,
            errorCode: "BENEFIT_GRANT_FAILED",
            errorMessage: message,
            metadata: {
              grantId: grant.id,
              sourceOrderId: grant.sourceOrderId,
              attemptCount: grant.attemptCount,
            },
          });
        }
      }
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
      console.error("[benefit-grant-worker] write system_event_log failed", error);
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
