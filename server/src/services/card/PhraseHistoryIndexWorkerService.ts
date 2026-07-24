import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { findPhraseMatches } from "@lf/core/text/phraseMatching.js";

export class PhraseHistoryIndexWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number; pageSize?: number } = {},
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const leaseMs = this.options.leaseMs ?? 60_000;
    const job = await this.repository.claimNextPhraseHistoryIndexJob(workerId, new Date(Date.now() + leaseMs));
    if (!job) return false;
    try {
      const phraseId = phraseIdFromPayload(job.payload) ?? job.sourceId;
      let cursor: string | undefined;
      let loaded = false;
      do {
        const source = await this.repository.loadPhraseIndexSource(
          phraseId,
          job.userId,
          cursor,
          this.options.pageSize ?? 200,
        );
        if (!source) {
          if (!loaded) await this.repository.completeWithoutResult(job, "PHRASE_HISTORY_SOURCE_MISSING");
          return true;
        }
        loaded = true;
        const occurrences = source.cards.flatMap((card) => [
          ...card.segments.flatMap((segment) =>
            findPhraseMatches(segment.text, source.variants, source.languageCode).map((match) => ({
              sourceKind: card.sourceKind,
              sourceId: card.sourceId,
              cardCreatedAt: card.cardCreatedAt,
              sourceField: "ai_expression" as const,
              segmentId: segment.segmentId,
              ...match,
            })),
          ),
          ...findPhraseMatches(card.originalText, source.variants, source.languageCode).map((match) => ({
            sourceKind: card.sourceKind,
            sourceId: card.sourceId,
            cardCreatedAt: card.cardCreatedAt,
            sourceField: "original" as const,
            segmentId: null,
            ...match,
          })),
        ]);
        await this.repository.upsertPhraseOccurrences(phraseId, job.userId, occurrences);
        cursor = source.nextCursor ?? undefined;
        if (cursor && !await this.repository.renewJobLease(job, new Date(Date.now() + leaseMs))) {
          throw new Error("PHRASE_HISTORY_JOB_LEASE_LOST");
        }
      } while (cursor);
      await this.repository.completeJob(job);
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

function phraseIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("phraseId" in payload)) return null;
  const value = (payload as { phraseId?: unknown }).phraseId;
  return typeof value === "string" && value ? value : null;
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "unknown")).slice(0, 500);
}
