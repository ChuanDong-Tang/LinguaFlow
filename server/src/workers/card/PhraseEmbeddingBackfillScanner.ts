import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export class PhraseEmbeddingBackfillScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly modelVersion: string,
    private readonly logs?: SystemEventLogRepository,
    private readonly options: { intervalMs?: number; batchSize?: number; maxOutstanding?: number } = {},
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const enqueued = await this.repository.enqueueMissingPhraseEmbeddingJobs({
        modelVersion: this.modelVersion,
        limit: this.options.batchSize ?? 20,
        maxOutstanding: this.options.maxOutstanding ?? 40,
      });
      if (enqueued) await this.logs?.create({
        module: "card",
        event: "phrase.embedding_backfill.enqueued",
        level: "info",
        status: "success",
        metadata: {
          enqueued,
          modelVersion: this.modelVersion,
          batchSize: this.options.batchSize ?? 20,
          maxOutstanding: this.options.maxOutstanding ?? 40,
        },
      });
    } catch (error) {
      await this.logs?.create({
        module: "card",
        event: "phrase.embedding_backfill.scan_failed",
        level: "error",
        status: "failed",
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        metadata: { modelVersion: this.modelVersion },
      }).catch(() => undefined);
    } finally {
      this.running = false;
    }
  }
}
