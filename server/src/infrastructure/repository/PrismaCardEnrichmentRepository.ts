import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type {
  CardEmbeddingSource,
  CardEnrichmentJobEntity,
  CardEnrichmentRepository,
  CardPhraseIndexOccurrence,
  CardPhraseIndexSource,
  PhraseIndexOccurrence,
  PhraseIndexSource,
  ProgressPhraseDetectionResult,
  ProgressPhraseDetectionSource,
} from "@lf/core/ports/repository/CardEnrichmentRepository.js";
import type { EmbeddingResult } from "@lf/core/ports/ai/EmbeddingProvider.js";

export class PrismaCardEnrichmentRepository implements CardEnrichmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimNextEmbeddingJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("generate_embedding", workerId, leaseExpiresAt);
  }

  async claimNextPhraseNormalizationJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("normalize_phrase", workerId, leaseExpiresAt);
  }

  async claimNextCardPhraseIndexJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("index_card_phrases", workerId, leaseExpiresAt);
  }

  async claimNextProgressPhraseDetectionJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("detect_progress_phrases", workerId, leaseExpiresAt);
  }

  async claimNextPhraseHistoryIndexJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("index_phrase_history", workerId, leaseExpiresAt);
  }

  private async claimNextJob(jobType: string, workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id"
           FROM "card_enrichment_jobs"
          WHERE "jobType" = $1
            AND (
              ("status" = 'queued' AND "availableAt" <= CURRENT_TIMESTAMP)
              OR ("status" = 'processing' AND "leaseExpiresAt" < CURRENT_TIMESTAMP)
            )
          ORDER BY "availableAt" ASC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        jobType,
      );
      const id = rows[0]?.id;
      if (!id) return null;
      const row = await tx.cardEnrichmentJob.update({
        where: { id },
        data: {
          status: "processing",
          attempts: { increment: 1 },
          processingAt: new Date(),
          leaseExpiresAt,
          workerId,
          lastError: null,
        },
      });
      return toJob(row);
    });
  }

  async loadPhraseNormalizationSource(job: CardEnrichmentJobEntity): Promise<{
    phraseId: string;
    userId: string;
    languageCode: string;
    surfaceText: string;
    observedSource: "observed_cloze" | "observed_card";
  } | null> {
    const phraseId = phraseIdFromPayload(job.payload);
    if (!phraseId) return null;
    const requireCloze = !payloadAllowsObservedCard(job.payload);
    const phrase = await this.prisma.phrase.findFirst({
      where: {
        id: phraseId,
        userId: job.userId,
        occurrences: { some: requireCloze ? { clozeBlankId: { not: null } } : {} },
      },
      select: {
        id: true,
        userId: true,
        languageCode: true,
        canonicalText: true,
        variants: { select: { source: true } },
      },
    });
    return phrase ? {
      phraseId: phrase.id,
      userId: phrase.userId,
      languageCode: phrase.languageCode,
      surfaceText: phrase.canonicalText,
      observedSource: phrase.variants.some((variant) => variant.source === "observed_cloze")
        ? "observed_cloze" as const
        : "observed_card" as const,
    } : null;
  }

  async completePhraseNormalization(job: CardEnrichmentJobEntity, input: {
    canonicalText: string;
    canonicalKey: string;
    variants: Array<{ surfaceText: string; normalizedText: string; source: "generated" | "observed_cloze" | "observed_card" }>;
    normalizerVersion: string;
  }): Promise<string | null> {
    const phraseId = phraseIdFromPayload(job.payload);
    if (!phraseId) return null;
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cardEnrichmentJob.updateMany({
        where: { id: job.id, status: "processing", workerId: job.workerId },
        data: {
          status: "completed",
          completedAt: new Date(),
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return null;
      const temporary = await tx.phrase.findFirst({ where: { id: phraseId, userId: job.userId } });
      if (!temporary) return null;
      const existing = await tx.phrase.findUnique({
        where: {
          userId_languageCode_canonicalKey: {
            userId: job.userId,
            languageCode: temporary.languageCode,
            canonicalKey: input.canonicalKey,
          },
        },
      });
      const targetId = existing?.id ?? temporary.id;
      const observed = await tx.phraseVariant.findMany({ where: { phraseId: temporary.id } });
      const variants = [
        ...observed.map((variant) => ({
          surfaceText: variant.surfaceText,
          normalizedText: variant.normalizedText,
          source: variant.source === "observed_cloze"
            ? "observed_cloze" as const
            : variant.source === "observed_card"
              ? "observed_card" as const
              : "generated" as const,
        })),
        ...input.variants,
      ];
      for (const variant of variants) {
        await tx.phraseVariant.upsert({
          where: { phraseId_normalizedText: { phraseId: targetId, normalizedText: variant.normalizedText } },
          create: {
            phraseId: targetId,
            userId: job.userId,
            languageCode: temporary.languageCode,
            surfaceText: variant.surfaceText,
            normalizedText: variant.normalizedText,
            source: variant.source,
            normalizerVersion: input.normalizerVersion,
          },
          update: variant.source === "observed_cloze" ? { source: "observed_cloze" } : {},
        });
      }
      if (targetId !== temporary.id) {
        await tx.$executeRawUnsafe(
          `DELETE FROM "phrase_occurrences" AS duplicate
            WHERE duplicate."phraseId" = $1
              AND EXISTS (
                SELECT 1 FROM "phrase_occurrences" AS target
                 WHERE target."phraseId" = $2
                   AND target."cardId" = duplicate."cardId"
                   AND target."sourceField" = duplicate."sourceField"
                   AND target."segmentKey" = duplicate."segmentKey"
                   AND target."startUtf16" = duplicate."startUtf16"
                   AND target."endUtf16" = duplicate."endUtf16"
              )`,
          temporary.id,
          targetId,
        );
        await tx.phraseOccurrence.updateMany({ where: { phraseId: temporary.id }, data: { phraseId: targetId } });
        await tx.phrase.delete({ where: { id: temporary.id } });
      }
      await tx.phrase.update({
        where: { id: targetId },
        data: {
          canonicalText: input.canonicalText,
          canonicalKey: input.canonicalKey,
          status: "normalized",
          normalizerVersion: input.normalizerVersion,
        },
      });
      await tx.cardEnrichmentJob.upsert({
        where: {
          userId_sourceKind_sourceId_jobType_inputVersion: {
            userId: job.userId,
            sourceKind: "phrase",
            sourceId: targetId,
            jobType: "index_phrase_history",
            inputVersion: `${input.normalizerVersion}:${targetId}`,
          },
        },
        create: {
          userId: job.userId,
          sourceKind: "phrase",
          sourceId: targetId,
          jobType: "index_phrase_history",
          inputHash: job.inputHash,
          inputVersion: `${input.normalizerVersion}:${targetId}`,
          payload: { phraseId: targetId, schemaVersion: 1 },
        },
        update: {
          status: "queued",
          availableAt: new Date(),
          attempts: 0,
          processingAt: null,
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
          completedAt: null,
          failedAt: null,
        },
      });
      return targetId;
    });
  }

  async loadPhraseIndexSource(phraseId: string, userId: string, cursor?: string, limit = 200): Promise<PhraseIndexSource | null> {
    const phrase = await this.prisma.phrase.findFirst({
      where: { id: phraseId, userId, status: "normalized" },
      select: {
        id: true,
        userId: true,
        languageCode: true,
        canonicalText: true,
        variants: { select: { surfaceText: true } },
      },
    });
    if (!phrase) return null;
    const cards = await this.prisma.card.findMany({
      where: {
        userId,
        languageCode: phrase.languageCode,
        status: "completed",
        deletedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
        originalText: true,
        segments: { orderBy: { ordinal: "asc" }, select: { id: true, text: true } },
      },
      orderBy: { id: "asc" },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
    });
    const page = cards.slice(0, limit);
    return {
      phraseId: phrase.id,
      userId: phrase.userId,
      languageCode: phrase.languageCode,
      variants: Array.from(new Set([phrase.canonicalText, ...phrase.variants.map((variant) => variant.surfaceText)])),
      cards: page.map((card) => ({
        sourceKind: "card",
        sourceId: card.id,
        cardCreatedAt: card.createdAt,
        originalText: card.originalText ?? "",
        segments: card.segments.map((segment) => ({ segmentId: segment.id, text: segment.text })),
      })),
      nextCursor: cards.length > limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async upsertPhraseOccurrences(
    phraseId: string,
    userId: string,
    occurrences: PhraseIndexOccurrence[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const occurrence of occurrences) {
        await tx.phraseOccurrence.upsert({
          where: {
            phraseId_cardId_sourceField_segmentKey_startUtf16_endUtf16: {
              phraseId,
              cardId: occurrence.sourceId,
              sourceField: occurrence.sourceField,
              segmentKey: occurrence.segmentId ?? "",
              startUtf16: occurrence.startUtf16,
              endUtf16: occurrence.endUtf16,
            },
          },
          create: {
            phraseId,
            userId,
            cardId: occurrence.sourceId,
            cardCreatedAt: occurrence.cardCreatedAt,
            sourceField: occurrence.sourceField,
            segmentId: occurrence.segmentId,
            segmentKey: occurrence.segmentId ?? "",
            startUtf16: occurrence.startUtf16,
            endUtf16: occurrence.endUtf16,
            surfaceText: occurrence.surfaceText,
            matchType: "variant",
          },
          update: { surfaceText: occurrence.surfaceText },
        });
      }
    });
  }

  async loadCardPhraseIndexSource(job: CardEnrichmentJobEntity, cursor?: string, limit = 500): Promise<CardPhraseIndexSource | null> {
    if (job.sourceKind !== "card") return null;
    const card = await this.prisma.card.findFirst({
      where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
      select: {
        id: true,
        userId: true,
        languageCode: true,
        createdAt: true,
        originalText: true,
        segments: { orderBy: { ordinal: "asc" }, select: { id: true, text: true } },
      },
    });
    if (!card?.originalText) return null;
    const phrases = await this.prisma.phrase.findMany({
      where: { userId: job.userId, languageCode: card.languageCode, status: "normalized" },
      select: {
        id: true,
        canonicalText: true,
        variants: { select: { surfaceText: true } },
      },
      orderBy: { id: "asc" },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: limit + 1,
    });
    const page = phrases.slice(0, limit);
    return {
      userId: card.userId,
      sourceId: card.id,
      languageCode: card.languageCode,
      cardCreatedAt: card.createdAt,
      originalText: card.originalText,
      segments: card.segments.map((segment) => ({ segmentId: segment.id, text: segment.text })),
      phrases: page.map((phrase) => ({
        phraseId: phrase.id,
        variants: Array.from(new Set([phrase.canonicalText, ...phrase.variants.map((variant) => variant.surfaceText)])),
      })),
      nextCursor: phrases.length > limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async upsertCardPhraseIndexOccurrences(
    job: CardEnrichmentJobEntity,
    occurrences: CardPhraseIndexOccurrence[],
  ): Promise<void> {
    const active = await this.prisma.cardEnrichmentJob.findFirst({
      where: { id: job.id, status: "processing", workerId: job.workerId, inputHash: job.inputHash },
      select: { id: true },
    });
    if (!active) return;
    await this.upsertCardOccurrences(job.userId, occurrences);
  }

  async completeCardPhraseIndexJob(
    job: CardEnrichmentJobEntity,
    occurrences: CardPhraseIndexOccurrence[],
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cardEnrichmentJob.updateMany({
        where: { id: job.id, status: "processing", workerId: job.workerId },
        data: {
          status: "completed",
          completedAt: new Date(),
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return false;
      await this.upsertCardOccurrences(job.userId, occurrences, tx);
      return true;
    });
  }

  private async upsertCardOccurrences(
    userId: string,
    occurrences: CardPhraseIndexOccurrence[],
    client: any = this.prisma,
  ): Promise<void> {
    for (const occurrence of occurrences) {
      const segmentKey = occurrence.segmentId ?? "";
      await client.phraseOccurrence.upsert({
          where: {
            phraseId_cardId_sourceField_segmentKey_startUtf16_endUtf16: {
              phraseId: occurrence.phraseId,
              cardId: occurrence.sourceId,
              sourceField: occurrence.sourceField,
              segmentKey,
              startUtf16: occurrence.startUtf16,
              endUtf16: occurrence.endUtf16,
            },
          },
          create: {
            phraseId: occurrence.phraseId,
            userId,
            cardId: occurrence.sourceId,
            cardCreatedAt: occurrence.cardCreatedAt,
            sourceField: occurrence.sourceField,
            segmentId: occurrence.segmentId,
            segmentKey,
            startUtf16: occurrence.startUtf16,
            endUtf16: occurrence.endUtf16,
            surfaceText: occurrence.surfaceText,
            matchType: "variant",
          },
          update: { surfaceText: occurrence.surfaceText },
      });
    }
  }

  async loadProgressPhraseDetectionSource(job: CardEnrichmentJobEntity): Promise<ProgressPhraseDetectionSource | null> {
    if (job.sourceKind !== "card") return null;
    const card = await this.prisma.card.findFirst({
      where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
      select: { id: true, userId: true, languageCode: true, createdAt: true, originalText: true },
    });
    if (!card?.originalText) return null;
    return {
      userId: card.userId,
      sourceKind: "card",
      sourceId: card.id,
      languageCode: card.languageCode,
      cardCreatedAt: card.createdAt,
      originalText: card.originalText,
    };
  }

  async completeProgressPhraseDetectionJob(
    job: CardEnrichmentJobEntity,
    phrases: ProgressPhraseDetectionResult[],
    normalizerVersion: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cardEnrichmentJob.updateMany({
        where: { id: job.id, status: "processing", workerId: job.workerId, inputHash: job.inputHash },
        data: {
          status: "completed",
          completedAt: new Date(),
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return false;
      const card = await tx.card.findFirst({
        where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
        select: { createdAt: true, languageCode: true },
      });
      if (!card) return true;
      for (const detected of phrases) {
        const phrase = await tx.phrase.upsert({
          where: {
            userId_languageCode_canonicalKey: {
              userId: job.userId,
              languageCode: card.languageCode,
              canonicalKey: detected.normalizedText,
            },
          },
          create: {
            userId: job.userId,
            languageCode: card.languageCode,
            canonicalText: detected.surfaceText,
            canonicalKey: detected.normalizedText,
            status: "pending_normalization",
            normalizerVersion,
          },
          update: {},
        });
        await tx.phraseVariant.upsert({
          where: { phraseId_normalizedText: { phraseId: phrase.id, normalizedText: detected.normalizedText } },
          create: {
            phraseId: phrase.id,
            userId: job.userId,
            languageCode: card.languageCode,
            surfaceText: detected.surfaceText,
            normalizedText: detected.normalizedText,
            source: "observed_card",
            normalizerVersion,
          },
          update: {},
        });
        for (const occurrence of detected.occurrences) {
          await tx.phraseOccurrence.upsert({
            where: {
              phraseId_cardId_sourceField_segmentKey_startUtf16_endUtf16: {
                phraseId: phrase.id,
                cardId: job.sourceId,
                sourceField: "original",
                segmentKey: "",
                startUtf16: occurrence.startUtf16,
                endUtf16: occurrence.endUtf16,
              },
            },
            create: {
              phraseId: phrase.id,
              userId: job.userId,
              cardId: job.sourceId,
              cardCreatedAt: card.createdAt,
              sourceField: "original",
              segmentId: null,
              segmentKey: "",
              startUtf16: occurrence.startUtf16,
              endUtf16: occurrence.endUtf16,
              surfaceText: occurrence.surfaceText,
              matchType: "exact",
            },
            update: { surfaceText: occurrence.surfaceText },
          });
        }
        if (phrase.status !== "normalized") {
          const inputVersion = `${normalizerVersion}:${phrase.id}`;
          await tx.cardEnrichmentJob.upsert({
            where: {
              userId_sourceKind_sourceId_jobType_inputVersion: {
                userId: job.userId,
                sourceKind: "card",
                sourceId: job.sourceId,
                jobType: "normalize_phrase",
                inputVersion,
              },
            },
            create: {
              userId: job.userId,
              sourceKind: "card",
              sourceId: job.sourceId,
              jobType: "normalize_phrase",
              inputHash: job.inputHash,
              inputVersion,
              payload: { phraseId: phrase.id, schemaVersion: 1, allowObservedCard: true },
            },
            update: {},
          });
        }
      }
      return true;
    });
  }

  async loadEmbeddingSource(job: CardEnrichmentJobEntity): Promise<CardEmbeddingSource | null> {
    if (job.sourceKind !== "card") return null;
    const card = await this.prisma.card.findFirst({
      where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
      select: { originalText: true, rewrittenText: true, topic: true },
    });
    if (!card?.originalText || !card.rewrittenText || !card.topic) return null;
    return {
      userId: job.userId,
      sourceKind: job.sourceKind,
      sourceId: job.sourceId,
      topic: card.topic,
      originalText: card.originalText,
      rewrittenText: card.rewrittenText,
    };
  }

  async completeEmbeddingJob(job: CardEnrichmentJobEntity, result: EmbeddingResult): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cardEnrichmentJob.updateMany({
        where: { id: job.id, status: "processing", workerId: job.workerId, inputHash: job.inputHash },
        data: {
          status: "completed",
          completedAt: new Date(),
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return false;
      const vector = `[${result.embedding.join(",")}]`;
      await tx.$executeRawUnsafe(
        `INSERT INTO "card_embeddings"
          ("id", "userId", "cardId", "provider", "model", "modelVersion", "dimensions", "inputHash", "embedding", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT ("cardId", "modelVersion")
         DO UPDATE SET
           "provider" = EXCLUDED."provider",
           "model" = EXCLUDED."model",
           "dimensions" = EXCLUDED."dimensions",
           "inputHash" = EXCLUDED."inputHash",
           "embedding" = EXCLUDED."embedding",
           "updatedAt" = CURRENT_TIMESTAMP`,
        randomUUID(),
        job.userId,
        job.sourceId,
        result.provider,
        result.model,
        result.modelVersion,
        result.dimensions,
        job.inputHash,
        vector,
      );
      return true;
    });
  }

  async completeWithoutResult(job: CardEnrichmentJobEntity, reason: string): Promise<boolean> {
    const result = await this.prisma.cardEnrichmentJob.updateMany({
      where: { id: job.id, status: "processing", workerId: job.workerId },
      data: {
        status: "completed",
        completedAt: new Date(),
        leaseExpiresAt: null,
        workerId: null,
        lastError: reason.slice(0, 500),
      },
    });
    return result.count === 1;
  }

  async completeJob(job: CardEnrichmentJobEntity): Promise<boolean> {
    const result = await this.prisma.cardEnrichmentJob.updateMany({
      where: { id: job.id, status: "processing", workerId: job.workerId },
      data: {
        status: "completed",
        completedAt: new Date(),
        leaseExpiresAt: null,
        workerId: null,
        lastError: null,
      },
    });
    return result.count === 1;
  }

  async rescheduleOrFail(job: CardEnrichmentJobEntity, errorMessage: string, availableAt: Date | null): Promise<boolean> {
    const terminal = availableAt === null;
    const result = await this.prisma.cardEnrichmentJob.updateMany({
      where: { id: job.id, status: "processing", workerId: job.workerId },
      data: {
        status: terminal ? "failed" : "queued",
        availableAt: availableAt ?? new Date(),
        leaseExpiresAt: null,
        workerId: null,
        lastError: errorMessage.slice(0, 500),
        failedAt: terminal ? new Date() : null,
      },
    });
    return result.count === 1;
  }

  async renewJobLease(job: CardEnrichmentJobEntity, leaseExpiresAt: Date): Promise<boolean> {
    const result = await this.prisma.cardEnrichmentJob.updateMany({
      where: { id: job.id, status: "processing", workerId: job.workerId },
      data: { leaseExpiresAt },
    });
    return result.count === 1;
  }
}

function toJob(row: {
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
}): CardEnrichmentJobEntity {
  return {
    id: row.id,
    userId: row.userId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    jobType: row.jobType,
    attempts: row.attempts,
    inputHash: row.inputHash,
    inputVersion: row.inputVersion,
    workerId: row.workerId,
    payload: row.payload,
  };
}

function phraseIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("phraseId" in payload)) return null;
  const phraseId = (payload as { phraseId?: unknown }).phraseId;
  return typeof phraseId === "string" && phraseId ? phraseId : null;
}

function payloadAllowsObservedCard(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && "allowObservedCard" in payload
    && (payload as { allowObservedCard?: unknown }).allowObservedCard === true);
}
