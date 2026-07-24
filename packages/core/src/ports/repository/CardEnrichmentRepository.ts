import type { EmbeddingResult } from "../ai/EmbeddingProvider.js";

export interface CardEnrichmentJobEntity {
  id: string;
  userId: string;
  sourceKind: string;
  sourceId: string;
  jobType: string;
  attempts: number;
  inputHash: string;
  inputVersion: string;
  workerId: string | null;
  payload: unknown;
}

export interface CardEmbeddingSource {
  userId: string;
  sourceKind: string;
  sourceId: string;
  topic: string;
  originalText: string;
  rewrittenText: string;
}

export interface PhraseIndexSource {
  phraseId: string;
  userId: string;
  languageCode: string;
  variants: string[];
  cards: Array<{
    sourceKind: "card";
    sourceId: string;
    cardCreatedAt: Date;
    originalText: string;
    segments: Array<{ segmentId: string; text: string }>;
  }>;
  nextCursor: string | null;
}

export interface PhraseIndexOccurrence {
  sourceKind: "card";
  sourceId: string;
  cardCreatedAt: Date;
  sourceField: "original" | "ai_expression";
  segmentId: string | null;
  startUtf16: number;
  endUtf16: number;
  surfaceText: string;
}

export interface CardPhraseIndexSource {
  userId: string;
  sourceId: string;
  languageCode: string;
  cardCreatedAt: Date;
  originalText: string;
  segments: Array<{ segmentId: string; text: string }>;
  phrases: Array<{ phraseId: string; variants: string[] }>;
  nextCursor: string | null;
}

export interface CardPhraseIndexOccurrence extends PhraseIndexOccurrence {
  phraseId: string;
}

export interface ProgressPhraseDetectionSource {
  userId: string;
  sourceKind: "card";
  sourceId: string;
  languageCode: string;
  cardCreatedAt: Date;
  originalText: string;
}

export interface ProgressPhraseDetectionResult {
  surfaceText: string;
  normalizedText: string;
  occurrences: Array<{ startUtf16: number; endUtf16: number; surfaceText: string }>;
}

export interface CardEnrichmentRepository {
  claimNextEmbeddingJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null>;
  loadEmbeddingSource(job: CardEnrichmentJobEntity): Promise<CardEmbeddingSource | null>;
  completeEmbeddingJob(job: CardEnrichmentJobEntity, result: EmbeddingResult): Promise<boolean>;
  completeWithoutResult(job: CardEnrichmentJobEntity, reason: string): Promise<boolean>;
  completeJob(job: CardEnrichmentJobEntity): Promise<boolean>;
  rescheduleOrFail(job: CardEnrichmentJobEntity, errorMessage: string, availableAt: Date | null): Promise<boolean>;
  renewJobLease(job: CardEnrichmentJobEntity, leaseExpiresAt: Date): Promise<boolean>;
  claimNextPhraseNormalizationJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null>;
  loadPhraseNormalizationSource(job: CardEnrichmentJobEntity): Promise<{
    phraseId: string;
    userId: string;
    languageCode: string;
    surfaceText: string;
    observedSource: "observed_cloze" | "observed_card";
  } | null>;
  completePhraseNormalization(job: CardEnrichmentJobEntity, input: {
    canonicalText: string;
    canonicalKey: string;
    variants: Array<{ surfaceText: string; normalizedText: string; source: "generated" | "observed_cloze" | "observed_card" }>;
    normalizerVersion: string;
  }): Promise<string | null>;
  loadPhraseIndexSource(phraseId: string, userId: string, cursor?: string, limit?: number): Promise<PhraseIndexSource | null>;
  upsertPhraseOccurrences(phraseId: string, userId: string, occurrences: PhraseIndexOccurrence[]): Promise<void>;
  claimNextPhraseHistoryIndexJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null>;
  claimNextCardPhraseIndexJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null>;
  loadCardPhraseIndexSource(job: CardEnrichmentJobEntity, cursor?: string, limit?: number): Promise<CardPhraseIndexSource | null>;
  upsertCardPhraseIndexOccurrences(job: CardEnrichmentJobEntity, occurrences: CardPhraseIndexOccurrence[]): Promise<void>;
  completeCardPhraseIndexJob(job: CardEnrichmentJobEntity, occurrences: CardPhraseIndexOccurrence[]): Promise<boolean>;
  claimNextProgressPhraseDetectionJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null>;
  loadProgressPhraseDetectionSource(job: CardEnrichmentJobEntity): Promise<ProgressPhraseDetectionSource | null>;
  completeProgressPhraseDetectionJob(
    job: CardEnrichmentJobEntity,
    phrases: ProgressPhraseDetectionResult[],
    normalizerVersion: string,
  ): Promise<boolean>;
}
