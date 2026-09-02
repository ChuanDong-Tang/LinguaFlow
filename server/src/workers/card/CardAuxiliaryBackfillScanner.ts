import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export class CardAuxiliaryBackfillScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: { intervalMs?: number; batchSize?: number; minimumAgeMs?: number } = {},
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 300_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const minimumAgeMs = this.options.minimumAgeMs ?? 86_400_000;
      const enqueued = await this.repository.enqueueMissingAuxiliaryJobs(
        this.options.batchSize ?? 20,
        new Date(Date.now() - minimumAgeMs),
      );
      if (enqueued > 0) await this.systemEventLogRepository?.create({
        module: "card",
        event: "card.auxiliary_backfill.enqueued",
        level: "info",
        status: "success",
        metadata: { enqueued, batchSize: this.options.batchSize ?? 20, minimumAgeMs },
      });
    } catch (error) {
      console.error("[card-auxiliary-backfill-scanner] round failed", error);
      await this.systemEventLogRepository?.create({
        module: "card",
        event: "card.auxiliary_backfill.scan_failed",
        level: "error",
        status: "failed",
        errorCode: error instanceof Error ? error.name.toUpperCase() : "UNKNOWN",
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      }).catch(() => undefined);
    } finally {
      this.running = false;
    }
  }
}
