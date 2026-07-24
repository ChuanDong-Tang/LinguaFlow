import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { ProgressPhraseDetectionService } from "./ProgressPhraseDetectionService.js";

export class ProgressPhraseDetectionWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly detector: ProgressPhraseDetectionService,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextProgressPhraseDetectionJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    try {
      const source = await this.repository.loadProgressPhraseDetectionSource(job);
      if (!source) {
        await this.repository.completeWithoutResult(job, "PROGRESS_PHRASE_SOURCE_MISSING");
        return true;
      }
      const detected = await this.detector.detect({
        userId: source.userId,
        originalText: source.originalText,
        languageCode: source.languageCode,
      });
      await this.repository.completeProgressPhraseDetectionJob(
        job,
        detected.phrases,
        detected.normalizerVersion,
      );
    } catch (error) {
      const maxAttempts = this.options.maxAttempts ?? 3;
      const retryAt = job.attempts >= maxAttempts
        ? null
        : new Date(Date.now() + Math.min(60_000, 1_000 * (2 ** Math.max(0, job.attempts - 1))));
      await this.repository.rescheduleOrFail(job, safeErrorMessage(error), retryAt);
    }
    return true;
  }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
