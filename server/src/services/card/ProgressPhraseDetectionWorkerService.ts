import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { ProgressPhraseDetectionService } from "./ProgressPhraseDetectionService.js";
import { resolveEnrichmentRetry, safeEnrichmentErrorMessage, safeEnrichmentErrorMetadata } from "./EnrichmentJobRetry.js";

export class ProgressPhraseDetectionWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly detector: ProgressPhraseDetectionService,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
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
      await this.log(job.userId, job.id, retry.retryAt ? "retry" : "failed", error, retry.retryAt);
    }
    return true;
  }

  private async log(
    userId: string,
    jobId: string,
    status: "retry" | "failed",
    error: unknown,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: `progress_phrase_${jobId}`,
        userId,
        module: "card",
        event: status === "retry" ? "card.progress_phrase_detection.retry" : "card.progress_phrase_detection.failed",
        level: status === "retry" ? "warn" : "error",
        status: status === "retry" ? "ignored" : "failed",
        errorCode: resolveErrorCode(error),
        errorMessage: safeEnrichmentErrorMessage(error),
        metadata: {
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
          ...safeEnrichmentErrorMetadata(error),
        },
      });
    } catch {
      // Observability must not change the job state.
    }
  }
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return error instanceof Error ? error.name.toUpperCase() : "UNKNOWN";
}
