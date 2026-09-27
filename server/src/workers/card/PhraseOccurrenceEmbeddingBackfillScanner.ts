import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export class PhraseOccurrenceEmbeddingBackfillScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly modelVersion: string,
    private readonly logs?: SystemEventLogRepository,
    private readonly options: { intervalMs?: number; batchSize?: number; maxOutstanding?: number; userId?: string } = {},
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const enqueued = await this.repository.enqueueMissingPhraseOccurrenceEmbeddingJobs({
        modelVersion: this.modelVersion,
        limit: this.options.batchSize ?? 5,
        maxOutstanding: this.options.maxOutstanding ?? 10,
        ...(this.options.userId ? { userId: this.options.userId } : {}),
      });
      if (enqueued) await this.logs?.create({
        module: "card",
        event: "phrase.occurrence_embedding_backfill.enqueued",
        level: "info",
        status: "success",
        metadata: {
          enqueued,
          modelVersion: this.modelVersion,
          batchSize: this.options.batchSize ?? 5,
          maxOutstanding: this.options.maxOutstanding ?? 10,
          scope: this.options.userId ? "target_user" : "all_users",
        },
      });
    } catch (error) {
      console.error("[phrase-occurrence-embedding-backfill-scanner] round failed", error);
      await this.logs?.create({
        module: "card",
        event: "phrase.occurrence_embedding_backfill.scan_failed",
        level: "error",
        status: "failed",
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        metadata: { modelVersion: this.modelVersion, scope: this.options.userId ? "target_user" : "all_users" },
      }).catch(() => undefined);
    } finally {
      this.running = false;
    }
  }
}
