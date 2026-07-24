import type { CardEnrichmentRepository } from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import { findPhraseMatches } from "@lf/core/text/phraseMatching.js";

export class CardPhraseIndexWorkerService {
  constructor(
    private readonly repository: CardEnrichmentRepository,
    private readonly options: { leaseMs?: number; maxAttempts?: number } = {},
  ) {}

  async claimAndProcess(workerId: string): Promise<boolean> {
    const job = await this.repository.claimNextCardPhraseIndexJob(
      workerId,
      new Date(Date.now() + (this.options.leaseMs ?? 60_000)),
    );
    if (!job) return false;
    try {
      let cursor: string | undefined;
      let loaded = false;
      do {
        const source = await this.repository.loadCardPhraseIndexSource(job, cursor, 500);
        if (!source) {
          if (!loaded) await this.repository.completeWithoutResult(job, "CARD_PHRASE_SOURCE_MISSING");
          return true;
        }
        loaded = true;
        const occurrences = source.phrases.flatMap((phrase) => [
          ...findPhraseMatches(source.originalText, phrase.variants, source.languageCode).map((match) => ({
            phraseId: phrase.phraseId,
            sourceKind: "card" as const,
            sourceId: source.sourceId,
            cardCreatedAt: source.cardCreatedAt,
            sourceField: "original" as const,
            segmentId: null,
            ...match,
          })),
          ...source.segments.flatMap((segment) =>
            findPhraseMatches(segment.text, phrase.variants, source.languageCode).map((match) => ({
              phraseId: phrase.phraseId,
              sourceKind: "card" as const,
              sourceId: source.sourceId,
              cardCreatedAt: source.cardCreatedAt,
              sourceField: "ai_expression" as const,
              segmentId: segment.segmentId,
              ...match,
            })),
          ),
        ]);
        await this.repository.upsertCardPhraseIndexOccurrences(job, occurrences);
        cursor = source.nextCursor ?? undefined;
        if (cursor && !await this.repository.renewJobLease(job, new Date(Date.now() + (this.options.leaseMs ?? 60_000)))) {
          throw new Error("CARD_PHRASE_JOB_LEASE_LOST");
        }
      } while (cursor);
      await this.repository.completeCardPhraseIndexJob(job, []);
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
