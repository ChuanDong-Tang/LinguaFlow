import { PHRASE_RELATION_JUDGE_PROMPT_VERSION } from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export class PhraseRelationJudgeBackfillScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly retrieval: {
      modelVersion: string;
      representationVersion: string;
      minPhraseSimilarity: number;
      minRepresentationSimilarity: number;
      representationWeight: number;
    },
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
      const enqueued = await this.repository.enqueueMissingPhraseRelationJudgeJobs({
        ...this.retrieval,
        promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION,
        limit: this.options.batchSize ?? 5,
        maxOutstanding: this.options.maxOutstanding ?? 10,
        ...(this.options.userId ? { userId: this.options.userId } : {}),
      });
      if (enqueued) await this.logs?.create({
        module: "card",
        event: "phrase.relation_judge_backfill.enqueued",
        level: "info",
        status: "success",
        metadata: { enqueued, promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION, scope: this.options.userId ? "target_user" : "all_users" },
      });
    } catch (error) {
      console.error("[phrase-relation-judge-backfill-scanner] round failed", error);
      await this.logs?.create({
        module: "card",
        event: "phrase.relation_judge_backfill.scan_failed",
        level: "error",
        status: "failed",
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        metadata: { promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION, scope: this.options.userId ? "target_user" : "all_users" },
      }).catch(() => undefined);
    } finally {
      this.running = false;
    }
  }
}
