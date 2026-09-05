import {
  CARD_IMAGE_DESCRIPTION_PROMPT_VERSION,
  CARD_IMAGE_DESCRIPTION_RESULT_VERSION,
} from "@lf/core/Prompts/cardImageDescriptionPrompt.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export class CardImageDescriptionBackfillScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly logs?: SystemEventLogRepository,
    private readonly options: {
      intervalMs?: number;
      batchSize?: number;
      maxOutstanding?: number;
      minimumAgeMs?: number;
      refreshOutdated?: boolean;
    } = {},
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
      const minimumAgeMs = this.options.minimumAgeMs ?? 60_000;
      const currentInputVersionPrefix = `${CARD_IMAGE_DESCRIPTION_PROMPT_VERSION}:${CARD_IMAGE_DESCRIPTION_RESULT_VERSION}:`;
      const cancelled = await this.repository.cancelObsoleteImageDescriptionJobs(
        currentInputVersionPrefix,
        "CARD_IMAGE_DESCRIPTION_VERSION_RETIRED",
      );
      const enqueued = await this.repository.enqueueMissingImageDescriptionJobs({
        limit: this.options.batchSize ?? 20,
        maxOutstanding: this.options.maxOutstanding ?? 40,
        createdBefore: new Date(Date.now() - minimumAgeMs),
        promptVersion: CARD_IMAGE_DESCRIPTION_PROMPT_VERSION,
        resultVersion: CARD_IMAGE_DESCRIPTION_RESULT_VERSION,
        refreshOutdated: this.options.refreshOutdated ?? false,
      });
      if (enqueued) await this.logs?.create({
        module: "card", event: "card.image_description_backfill.enqueued",
        level: "info", status: "success",
        metadata: {
          enqueued,
          cancelledObsolete: cancelled,
          minimumAgeMs,
          maxOutstanding: this.options.maxOutstanding ?? 40,
          refreshOutdated: this.options.refreshOutdated ?? false,
          promptVersion: CARD_IMAGE_DESCRIPTION_PROMPT_VERSION,
          resultVersion: CARD_IMAGE_DESCRIPTION_RESULT_VERSION,
        },
      });
      else if (cancelled) await this.logs?.create({
        module: "card", event: "card.image_description_backfill.obsolete_cancelled",
        level: "info", status: "success",
        metadata: { cancelled, promptVersion: CARD_IMAGE_DESCRIPTION_PROMPT_VERSION, resultVersion: CARD_IMAGE_DESCRIPTION_RESULT_VERSION },
      });
    } catch (error) {
      await this.logs?.create({
        module: "card", event: "card.image_description_backfill.scan_failed",
        level: "error", status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      }).catch(() => undefined);
    } finally {
      this.running = false;
    }
  }
}
