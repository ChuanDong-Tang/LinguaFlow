import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { ProgressPhraseDetectionService } from "./ProgressPhraseDetectionService.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage } from "./EnrichmentJobRetry.js";

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
        requestId: `progress_phrase_${job.id}:attempt:${job.attempts}`,
        // Progress detection runs automatically after card processing and is a
        // platform cost rather than a user-visible AI request.
        tokenMetered: false,
        originalText: source.originalText,
        languageCode: source.languageCode,
      });
      await this.repository.completeProgressPhraseDetectionJob(
        job,
        detected.phrases,
        detected.normalizerVersion,
      );
    } catch (error) {
      const retry = resolveEnrichmentRetry(error, job.attempts, this.options.maxAttempts ?? 3);
      await this.repository.rescheduleOrFail(
        job,
        safeEnrichmentErrorMessage(error),
        retry.retryAt,
        { preserveAttempt: retry.preserveAttempt },
      );
    }
    return true;
  }
}
