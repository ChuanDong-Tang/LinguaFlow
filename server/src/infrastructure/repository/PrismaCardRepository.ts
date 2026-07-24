import type {
  CompleteCardEntryInput,
  CreateQueuedCardEntryInput,
  CardEntryEntity,
  CardRepository,
  CardPracticeStateEntity,
  CardSpeechAssetEntity,
  CardImageAssetEntity,
  CardSegmentEntity,
} from "@lf/core/ports/repository/CardRepository.js";
import type { AppLocale } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { CardEntryStatus } from "@lf/core/types/cardRecord.js";
import { countGraphemes } from "@lf/core/text/grapheme.js";
import { isTargetLanguageCode, type TargetLanguageCode } from "@lf/core/language/targetLanguages.js";

type PrismaCardClient = {
  card: {
    create: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  cardRewriteSegment: {
    deleteMany: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
  };
  cardImageAsset: {
    create: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  cardPracticeState: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    upsert: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
  };
  cardSpeechAsset: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  cardEnrichmentJob: {
    upsert: (args: any) => Promise<any>;
  };
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

const includeSegments = {
  segments: { orderBy: { ordinal: "asc" } },
  image: true,
} as const;

export class PrismaCardRepository implements CardRepository {
  constructor(private readonly prisma: PrismaCardClient) {}

  async hasAnyByUser(userId: string): Promise<boolean> {
    return Boolean(await this.prisma.card.findFirst({
      where: { userId },
      select: { id: true },
    }));
  }

  async listByUser(
    userId: string,
    collectionId: string | null | undefined,
    limit: number,
  ): Promise<CardEntryEntity[]> {
    return this.prisma.card.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { notIn: ["failed", "deleted"] },
        ...(collectionId !== undefined ? { collectionId } : {}),
      },
      include: includeSegments,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  }

  async createSamples(input: {
    userId: string;
    dateKey: string;
    languageCode: string;
    appLocaleSnapshot: AppLocale;
    promptDifficultySnapshot: string;
    promptVersion: string;
  }): Promise<CardEntryEntity[]> {
    const samples = sampleRows(input.languageCode, input.appLocaleSnapshot);
    return this.prisma.$transaction(async (tx) => {
      await tx.card.createMany({
        data: samples.map((sample, index) => ({
          userId: input.userId,
          dateKey: input.dateKey,
          originalText: sample.originalText,
          rewrittenText: sample.rewrittenText,
          topic: sample.topic,
          languageCode: input.languageCode,
          appLocaleSnapshot: input.appLocaleSnapshot,
          promptDifficultySnapshot: input.promptDifficultySnapshot,
          promptVersion: input.promptVersion,
          clientId: `sample:v1:${index + 1}`,
          inputChars: countGraphemes(sample.originalText),
          outputChars: countGraphemes(sample.rewrittenText),
          status: "completed",
          isSample: true,
          publishedAt: new Date(),
        })),
        skipDuplicates: true,
      });
      const rows = await tx.card.findMany({
        where: { userId: input.userId, clientId: { in: ["sample:v1:1", "sample:v1:2"] } },
        orderBy: [{ createdAt: "asc" }],
        include: includeSegments,
      });
      for (const row of rows) {
        const sample = samples[Number(row.clientId.slice(-1)) - 1];
        if (!sample) continue;
        await tx.cardRewriteSegment.createMany({
          data: [{
            entryId: row.id,
            ordinal: 0,
            text: sample.rewrittenText,
            startUtf16: 0,
            endUtf16: sample.rewrittenText.length,
          }],
          skipDuplicates: true,
        });
      }
      const completed = await tx.card.findMany({
        where: { userId: input.userId, clientId: { in: ["sample:v1:1", "sample:v1:2"] }, status: "completed" },
        orderBy: [{ createdAt: "asc" }],
        include: includeSegments,
      });
      return completed.map(toEntry);
    });
  }

  async createQueued(input: CreateQueuedCardEntryInput): Promise<CardEntryEntity> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.card.create({
        data: {
          userId: input.userId,
          dateKey: input.dateKey,
          originalText: input.originalText,
          languageCode: input.languageCode,
          appLocaleSnapshot: input.appLocaleSnapshot,
          promptDifficultySnapshot: input.promptDifficultySnapshot,
          promptVersion: input.promptVersion,
          clientId: input.clientId,
          inputChars: input.inputChars,
          status: "queued",
        },
        include: includeSegments,
      });
      if (input.imageUploadId) {
        const claimed = await tx.cardImageAsset.updateMany({
          where: {
            id: input.imageUploadId,
            userId: input.userId,
            entryId: null,
            status: { in: ["approved", "approved_with_review"] },
            expiresAt: { gt: new Date() },
          },
          data: { entryId: row.id, claimedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("CARD_IMAGE_NOT_READY");

        // `row` was loaded before the image was claimed, so its included image
        // relation is stale. Reload it so the create response can already carry
        // the thumbnail while the rewrite task is still queued/processing.
        const rowWithImage = await tx.card.findUnique({
          where: { id: row.id },
          include: includeSegments,
        });
        if (!rowWithImage) throw new Error("CARD_ENTRY_NOT_FOUND_AFTER_CREATE");
        return toEntry(rowWithImage);
      }
      return toEntry(row);
    });
  }

  async findByUserClientId(userId: string, clientId: string): Promise<CardEntryEntity | null> {
    const row = await this.prisma.card.findFirst({
      where: { userId, clientId },
      include: includeSegments,
    });
    return row ? toEntry(row) : null;
  }

  async findByIdForUser(entryId: string, userId: string): Promise<CardEntryEntity | null> {
    const row = await this.prisma.card.findFirst({
      where: { id: entryId, userId },
      include: includeSegments,
    });
    return row ? toEntry(row) : null;
  }

  async findActiveByUser(userId: string): Promise<CardEntryEntity | null> {
    const row = await this.prisma.card.findFirst({
      where: { userId, status: { in: ["queued", "processing"] } },
      orderBy: [{ createdAt: "asc" }],
      include: includeSegments,
    });
    return row ? toEntry(row) : null;
  }

  async listByUserDate(userId: string, dateKey: string, limit: number): Promise<CardEntryEntity[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        userId,
        dateKey,
        status: { in: ["queued", "processing", "completed"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: includeSegments,
    });
    return rows.map(toEntry);
  }

  async listDateKeysByUser(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        userId,
        dateKey: { gte: fromDateKey, lte: toDateKey },
        status: { in: ["queued", "processing", "completed"] },
      },
      distinct: ["dateKey"],
      select: { dateKey: true },
      orderBy: { dateKey: "asc" },
    });
    return rows.map((row: { dateKey: string }) => row.dateKey);
  }

  async listRecentCompleted(userId: string, beforeDateKey: string, limit: number): Promise<CardEntryEntity[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        userId,
        dateKey: { lt: beforeDateKey },
        status: "completed",
        isSample: false,
      },
      orderBy: [{ dateKey: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: includeSegments,
    });
    return rows.map(toEntry);
  }

  async claimNextQueued(workerId: string, leaseExpiresAt: Date): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT "id"
           FROM "cards"
          WHERE "status" = 'queued'
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      )) as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) return null;
      const row = await tx.card.update({
        where: { id },
        data: {
          status: "processing",
          workerId,
          processingAt: new Date(),
          leaseExpiresAt,
        },
        include: includeSegments,
      });
      return toEntry(row);
    });
  }

  async renewLease(entryId: string, workerId: string, leaseExpiresAt: Date): Promise<boolean> {
    const result = await this.prisma.card.updateMany({
      where: { id: entryId, workerId, status: "processing" },
      data: { leaseExpiresAt },
    });
    return result.count === 1;
  }

  async complete(input: CompleteCardEntryInput): Promise<CardEntryEntity> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.card.updateMany({
        where: { id: input.entryId, workerId: input.workerId, status: "processing" },
        data: {
          rewrittenText: input.rewrittenText,
          topic: input.topic,
          topicEditedAt: null,
          outputChars: input.outputChars,
          status: "completed",
          publishedAt: input.publishedAt,
          leaseExpiresAt: null,
          workerId: null,
        },
      });
      if (changed.count !== 1) throw new Error("CARD_TASK_LEASE_LOST");
      await tx.cardRewriteSegment.deleteMany({ where: { entryId: input.entryId } });
      if (input.segments.length) {
        await tx.cardRewriteSegment.createMany({
          data: input.segments.map((segment) => ({ entryId: input.entryId, ...segment })),
        });
      }
      const completedEntry = await tx.card.findFirst({
        where: { id: input.entryId },
        select: { userId: true, isSample: true },
      });
      if (!completedEntry) throw new Error("CARD_NOT_FOUND_AFTER_COMPLETE");
      await tx.cardEnrichmentJob.upsert({
        where: {
          userId_sourceKind_sourceId_jobType_inputVersion: {
            userId: completedEntry.userId,
            sourceKind: "card",
            sourceId: input.entryId,
            jobType: "generate_embedding",
            inputVersion: input.embeddingInputVersion,
          },
        },
        create: {
          userId: completedEntry.userId,
          sourceKind: "card",
          sourceId: input.entryId,
          jobType: "generate_embedding",
          inputHash: input.embeddingInputHash,
          inputVersion: input.embeddingInputVersion,
          payload: { schemaVersion: 1 },
        },
        update: {
          status: "queued",
          availableAt: new Date(),
          inputHash: input.embeddingInputHash,
          payload: { schemaVersion: 1 },
          attempts: 0,
          processingAt: null,
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
          completedAt: null,
          failedAt: null,
        },
      });
      await tx.cardEnrichmentJob.upsert({
        where: {
          userId_sourceKind_sourceId_jobType_inputVersion: {
            userId: completedEntry.userId,
            sourceKind: "card",
            sourceId: input.entryId,
            jobType: "index_card_phrases",
            inputVersion: `card_phrase_index_v1:${input.embeddingInputHash}`,
          },
        },
        create: {
          userId: completedEntry.userId,
          sourceKind: "card",
          sourceId: input.entryId,
          jobType: "index_card_phrases",
          inputHash: input.embeddingInputHash,
          inputVersion: `card_phrase_index_v1:${input.embeddingInputHash}`,
          payload: { schemaVersion: 1 },
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
      await tx.cardEnrichmentJob.upsert({
        where: {
          userId_sourceKind_sourceId_jobType_inputVersion: {
            userId: completedEntry.userId,
            sourceKind: "card",
            sourceId: input.entryId,
            jobType: "detect_progress_phrases",
            inputVersion: `progress_phrase_detection_v1:${input.embeddingInputHash}`,
          },
        },
        create: {
          userId: completedEntry.userId,
          sourceKind: "card",
          sourceId: input.entryId,
          jobType: "detect_progress_phrases",
          inputHash: input.embeddingInputHash,
          inputVersion: `progress_phrase_detection_v1:${input.embeddingInputHash}`,
          payload: { schemaVersion: 1 },
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
      if (completedEntry && !completedEntry.isSample) {
        const visibleSamples = await tx.card.findMany({
          where: { userId: completedEntry.userId, isSample: true, status: "completed" },
          select: { id: true },
        });
        const sampleIds = visibleSamples.map((sample: { id: string }) => sample.id);
        if (sampleIds.length) {
          await tx.card.updateMany({
            where: { id: { in: sampleIds } },
            data: {
              status: "deleted",
              originalText: null,
              rewrittenText: null,
              deletedAt: input.publishedAt,
            },
          });
          await tx.cardRewriteSegment.deleteMany({ where: { entryId: { in: sampleIds } } });
        }
      }
      const row = await tx.card.findFirst({
        where: { id: input.entryId },
        include: includeSegments,
      });
      if (!row) throw new Error("CARD_ENTRY_NOT_FOUND");
      return toEntry(row);
    });
  }

  async markFailedAndScrub(
    entryId: string,
    workerId: string | null,
    failedAt: Date,
    leaseExpiredBefore?: Date,
  ): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.card.updateMany({
        where: {
          id: entryId,
          status: { in: ["queued", "processing"] },
          ...(workerId ? { OR: [{ workerId }, { workerId: null }] } : {}),
          ...(leaseExpiredBefore ? { leaseExpiresAt: { lt: leaseExpiredBefore } } : {}),
        },
        data: {
          status: "failed",
          originalText: null,
          rewrittenText: null,
          failedAt,
          leaseExpiresAt: null,
          workerId: null,
        },
      });
      if (changed.count !== 1) return null;
      await tx.cardRewriteSegment.deleteMany({ where: { entryId } });
      await tx.cardImageAsset.updateMany({
        where: { entryId },
        data: { entryId: null, status: "cleanup_pending" },
      });
      const row = await tx.card.findFirst({
        where: { id: entryId },
        include: includeSegments,
      });
      return row ? toEntry(row) : null;
    });
  }

  async listExpiredProcessing(now: Date, limit: number): Promise<CardEntryEntity[]> {
    const rows = await this.prisma.card.findMany({
      where: { status: "processing", leaseExpiresAt: { lt: now } },
      orderBy: [{ leaseExpiresAt: "asc" }],
      take: limit,
      include: includeSegments,
    });
    return rows.map(toEntry);
  }

  async markDeleted(entryId: string, userId: string, deletedAt: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.card.updateMany({
        where: { id: entryId, userId, status: "completed" },
        data: {
          status: "deleted",
          originalText: null,
          rewrittenText: null,
          deletedAt,
        },
      });
      if (result.count !== 1) return false;
      const affectedPhrases = await tx.phraseOccurrence.findMany({
        where: { userId, cardId: entryId },
        select: { phraseId: true },
        distinct: ["phraseId"],
      });
      const affectedPhraseIds = affectedPhrases.map((item: { phraseId: string }) => item.phraseId);
      const sessionsContainingCard = await tx.recallSessionNode.findMany({
        where: { cardId: entryId, session: { userId } },
        select: { sessionId: true },
        distinct: ["sessionId"],
      });
      if (sessionsContainingCard.length) {
        // Recall sessions are temporary snapshots and may contain the deleted text in edge reasons.
        await tx.recallSession.deleteMany({
          where: { id: { in: sessionsContainingCard.map((item: { sessionId: string }) => item.sessionId) }, userId },
        });
      }
      await tx.cardEnrichmentJob.deleteMany({ where: { userId, sourceKind: "card", sourceId: entryId } });
      await tx.cardEmbedding.deleteMany({ where: { userId, cardId: entryId } });
      await tx.phraseOccurrence.deleteMany({ where: { userId, cardId: entryId } });
      if (affectedPhraseIds.length) {
        const orphanedPhrases = await tx.phrase.findMany({
          where: { id: { in: affectedPhraseIds }, userId, occurrences: { none: {} } },
          select: { id: true },
        });
        const orphanedPhraseIds = orphanedPhrases.map((item: { id: string }) => item.id);
        await tx.cardEnrichmentJob.deleteMany({
          where: { userId, sourceKind: "phrase", sourceId: { in: orphanedPhraseIds } },
        });
        await tx.phrase.deleteMany({
          where: { id: { in: orphanedPhraseIds }, userId },
        });
      }
      await tx.cardRewriteSegment.deleteMany({ where: { entryId } });
      await tx.cardImageAsset.updateMany({
        where: { entryId },
        data: { entryId: null, status: "cleanup_pending" },
      });
      await tx.cardPracticeState.deleteMany({
        where: { userId, cardId: entryId },
      });
      await tx.cardSpeechAsset.updateMany({
        where: {
          entryId,
          sourceKind: { in: ["review_segment", "dictation_sentence"] },
        },
        data: { status: "cleanup_pending", objectUrl: null, objectUrlExpiresAt: null },
      });
      return true;
    });
  }

  async findPracticeState(userId: string, cardId: string): Promise<CardPracticeStateEntity | null> {
    const row = await this.prisma.cardPracticeState.findUnique({
      where: { cardId },
    });
    return row?.userId === userId ? toPracticeState(row) : null;
  }

  async saveDictationResult(input: {
    userId: string;
    cardId: string;
    result: "correct" | "incorrect" | "revealed";
    practicedAt: Date;
    nextReviewAt: Date;
    correctStreak: number;
  }): Promise<CardPracticeStateEntity> {
    const row = await this.prisma.cardPracticeState.upsert({
      where: { cardId: input.cardId },
      create: {
        userId: input.userId,
        cardId: input.cardId,
        dictationLastResult: input.result,
        dictationCorrectStreak: input.correctStreak,
        dictationNextReviewAt: input.nextReviewAt,
      },
      update: {
        dictationLastResult: input.result,
        dictationCorrectStreak: input.correctStreak,
        dictationNextReviewAt: input.nextReviewAt,
      },
    });
    return toPracticeState(row);
  }

  async saveClozeState(input: {
    userId: string;
    cardId: string;
    expectedVersion: number;
    state: unknown;
    result: "correct" | "incorrect" | "revealed" | null;
    practicedAt: Date | null;
    nextReviewAt: Date | null;
    correctStreak: number;
    phraseMutation?:
      | {
          type: "add";
          languageCode: string;
          cardCreatedAt: Date;
          segmentId: string;
          startUtf16: number;
          endUtf16: number;
          surfaceText: string;
          normalizedText: string;
          clozeBlankId: string;
          normalizerVersion: string;
          inputHash: string;
        }
      | { type: "remove"; clozeBlankId: string };
  }): Promise<CardPracticeStateEntity | null> {
    const key = { cardId: input.cardId, userId: input.userId };
    const practiceData = input.result ? {
      clozeLastResult: input.result,
      clozeCorrectStreak: input.correctStreak,
      clozeNextReviewAt: input.nextReviewAt,
    } : {};
    try {
      return await this.prisma.$transaction(async (tx) => {
        let row: any;
        if (input.expectedVersion === 0) {
          const changed = await tx.cardPracticeState.updateMany({
            where: { ...key, clozeVersion: 0 },
            data: { clozeState: input.state, clozeVersion: { increment: 1 }, ...practiceData },
          });
          if (changed.count === 1) {
            row = await tx.cardPracticeState.findUnique({
              where: { cardId: input.cardId },
            });
          } else {
            row = await tx.cardPracticeState.create({
              data: {
                ...key,
                clozeState: input.state,
                clozeVersion: 1,
                ...(input.result ? {
                  clozeLastResult: input.result,
                  clozeCorrectStreak: input.correctStreak,
                  clozeNextReviewAt: input.nextReviewAt,
                } : {}),
              },
            });
          }
        } else {
          const changed = await tx.cardPracticeState.updateMany({
            where: { ...key, clozeVersion: input.expectedVersion },
            data: { clozeState: input.state, clozeVersion: { increment: 1 }, ...practiceData },
          });
          if (changed.count !== 1) return null;
          row = await tx.cardPracticeState.findUnique({
            where: { cardId: input.cardId },
          });
        }
        if (!row) return null;
        await applyPhraseMutation(tx, input);
        return toPracticeState(row);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  async deleteFailedTombstonesBefore(before: Date, limit: number): Promise<number> {
    const rows = await this.prisma.card.findMany({
      where: { status: "failed", failedAt: { lt: before }, originalText: null, rewrittenText: null },
      orderBy: [{ failedAt: "asc" }],
      take: Math.max(1, limit),
      select: { id: true },
    });
    if (!rows.length) return 0;
    const result = await this.prisma.card.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, status: "failed" },
    });
    return result.count;
  }

  async findReadySpeechAsset(cacheKey: string): Promise<CardSpeechAssetEntity | null> {
    const row = await this.prisma.cardSpeechAsset.findUnique({ where: { cacheKey } });
    if (row?.status !== "ready") return null;
    const touched = await this.prisma.cardSpeechAsset.update({
      where: { id: row.id },
      data: { lastAccessedAt: new Date() },
    });
    return toSpeechAsset(touched);
  }

  async saveReadySpeechAsset(input: Omit<CardSpeechAssetEntity, "id">): Promise<CardSpeechAssetEntity> {
    const row = await this.prisma.cardSpeechAsset.upsert({
      where: { cacheKey: input.cacheKey },
      create: { ...input, status: "ready", lastAccessedAt: new Date() },
      update: {
        ...input,
        status: "ready",
        lastAccessedAt: new Date(),
      },
    });
    return toSpeechAsset(row);
  }

  async updateSpeechAssetUrl(
    id: string,
    objectUrl: string | null,
    objectUrlExpiresAt: Date | null,
  ): Promise<CardSpeechAssetEntity> {
    const row = await this.prisma.cardSpeechAsset.update({
      where: { id },
      data: { objectUrl, objectUrlExpiresAt, lastAccessedAt: new Date() },
    });
    return toSpeechAsset(row);
  }

  async listSpeechAssetsForCleanup(staleDictionaryBefore: Date, limit: number): Promise<CardSpeechAssetEntity[]> {
    const rows = await this.prisma.cardSpeechAsset.findMany({
      where: {
        OR: [
          { status: "cleanup_pending", sourceKind: { in: ["review_segment", "dictation_sentence"] } },
          { status: "ready", sourceKind: "dictionary_term", lastAccessedAt: { lt: staleDictionaryBefore } },
        ],
      },
      orderBy: [{ updatedAt: "asc" }],
      take: Math.max(1, limit),
    });
    return rows.map(toSpeechAsset);
  }

  async deleteSpeechAsset(id: string, staleDictionaryBefore: Date): Promise<boolean> {
    const result = await this.prisma.cardSpeechAsset.deleteMany({
      where: {
        id,
        OR: [
          { status: "cleanup_pending" },
          { status: "ready", sourceKind: "dictionary_term", lastAccessedAt: { lt: staleDictionaryBefore } },
        ],
      },
    });
    return result.count === 1;
  }

  async claimSpeechAssetCleanup(id: string, staleDictionaryBefore: Date): Promise<boolean> {
    const result = await this.prisma.cardSpeechAsset.updateMany({
      where: {
        id,
        OR: [
          { status: "cleanup_pending" },
          { status: "ready", sourceKind: "dictionary_term", lastAccessedAt: { lt: staleDictionaryBefore } },
        ],
      },
      data: { status: "cleanup_pending", objectUrl: null, objectUrlExpiresAt: null },
    });
    return result.count === 1;
  }

  async createImageUploadWithinQuota(input: {
    id: string;
    userId: string;
    quotaDateKey: string;
    objectKey: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    expiresAt: Date;
  }): Promise<CardImageAssetEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const reserved = await tx.$executeRaw`
        UPDATE "entitlements"
           SET "usedImages" = "usedImages" + 1,
               "updatedAt" = NOW()
         WHERE "userId" = ${input.userId}
           AND "dateKey" = ${input.quotaDateKey}
           AND "usedImages" < "imageLimit"
      `;
      if (reserved !== 1) return null;
      const row = await tx.cardImageAsset.create({
        data: {
          id: input.id,
          userId: input.userId,
          status: "uploading",
          originalObjectKey: input.objectKey,
          uploadObjectKey: input.objectKey,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          width: input.width,
          height: input.height,
          expiresAt: input.expiresAt,
        },
      });
      return toImageAsset(row);
    });
  }

  async findImageUpload(id: string, userId: string): Promise<CardImageAssetEntity | null> {
    const row = await this.prisma.cardImageAsset.findFirst({ where: { id, userId } });
    return row ? toImageAsset(row) : null;
  }

  async updateImageUploadModeration(input: {
    id: string;
    userId: string;
    status: string;
    fileMd5: string;
    moderationRequestId?: string | null;
    moderationSuggestion?: string | null;
    moderationLabel?: string | null;
    originalObjectKey?: string;
  }): Promise<CardImageAssetEntity | null> {
    const changed = await this.prisma.cardImageAsset.updateMany({
      where: { id: input.id, userId: input.userId, entryId: null },
      data: {
        status: input.status,
        fileMd5: input.fileMd5,
        moderationRequestId: input.moderationRequestId ?? null,
        moderationSuggestion: input.moderationSuggestion ?? null,
        moderationLabel: input.moderationLabel ?? null,
        ...(input.originalObjectKey ? { originalObjectKey: input.originalObjectKey } : {}),
        moderatedAt: new Date(),
      },
    });
    if (changed.count !== 1) return null;
    return this.findImageUpload(input.id, input.userId);
  }

  async markImageUploadCleanup(id: string, userId: string): Promise<CardImageAssetEntity | null> {
    const changed = await this.prisma.cardImageAsset.updateMany({
      where: { id, userId, entryId: null },
      data: { status: "cleanup_pending" },
    });
    return changed.count === 1 ? this.findImageUpload(id, userId) : null;
  }

  async updateImageThumbnail(input: {
    id: string;
    userId: string;
    thumbnailObjectKey: string;
    thumbnailVersion: number;
  }): Promise<CardImageAssetEntity | null> {
    const changed = await this.prisma.cardImageAsset.updateMany({
      where: { id: input.id, userId: input.userId },
      data: {
        thumbnailObjectKey: input.thumbnailObjectKey,
        thumbnailStatus: "ready",
        thumbnailVersion: input.thumbnailVersion,
      },
    });
    return changed.count === 1 ? this.findImageUpload(input.id, input.userId) : null;
  }

  async listImageAssetsForCleanup(now: Date, limit: number): Promise<CardImageAssetEntity[]> {
    const rows = await this.prisma.cardImageAsset.findMany({
      where: {
        entryId: null,
        OR: [
          { status: "cleanup_pending" },
          { expiresAt: { lt: now } },
        ],
      },
      orderBy: [{ expiresAt: "asc" }],
      take: Math.max(1, limit),
    });
    return rows.map(toImageAsset);
  }

  async deleteUnclaimedImageAsset(id: string): Promise<boolean> {
    const result = await this.prisma.cardImageAsset.deleteMany({ where: { id, entryId: null } });
    return result.count === 1;
  }

  async listImageUploadObjectsForCleanup(limit: number): Promise<CardImageAssetEntity[]> {
    const rows = await this.prisma.cardImageAsset.findMany({
      where: { status: { in: ["approved", "approved_with_review"] }, uploadObjectKey: { not: null } },
      orderBy: [{ updatedAt: "asc" }],
      take: Math.max(1, limit),
    });
    return rows.map(toImageAsset);
  }

  async clearImageUploadObjectKey(id: string, objectKey: string): Promise<boolean> {
    const result = await this.prisma.cardImageAsset.updateMany({
      where: { id, uploadObjectKey: objectKey },
      data: { uploadObjectKey: null },
    });
    return result.count === 1;
  }

  async replaceEntryImage(input: {
    entryId: string;
    userId: string;
    imageUploadId: string | null;
  }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed" },
        include: includeSegments,
      });
      if (!entry) return null;
      if (entry.image?.id === input.imageUploadId) return toEntry(entry);
      await tx.cardImageAsset.updateMany({
        where: { entryId: entry.id },
        data: { entryId: null, status: "cleanup_pending" },
      });
      if (input.imageUploadId) {
        const claimed = await tx.cardImageAsset.updateMany({
          where: {
            id: input.imageUploadId,
            userId: input.userId,
            entryId: null,
            status: { in: ["approved", "approved_with_review"] },
            thumbnailStatus: "ready",
            expiresAt: { gt: new Date() },
          },
          data: { entryId: entry.id, claimedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("CARD_IMAGE_NOT_READY");
      }
      const updated = await tx.card.findFirst({
        where: { id: entry.id },
        include: includeSegments,
      });
      return updated ? toEntry(updated) : null;
    });
  }
}

async function applyPhraseMutation(tx: any, input: {
  userId: string;
  cardId: string;
  phraseMutation?:
    | {
        type: "add";
        languageCode: string;
        cardCreatedAt: Date;
        segmentId: string;
        startUtf16: number;
        endUtf16: number;
        surfaceText: string;
        normalizedText: string;
        clozeBlankId: string;
        normalizerVersion: string;
        inputHash: string;
      }
    | { type: "remove"; clozeBlankId: string };
}): Promise<void> {
  const mutation = input.phraseMutation;
  if (!mutation) return;
  if (mutation.type === "remove") {
    await tx.phraseOccurrence.updateMany({
      where: {
        userId: input.userId,
        cardId: input.cardId,
        clozeBlankId: mutation.clozeBlankId,
      },
      data: { clozeBlankId: null },
    });
    return;
  }

  const phrase = await tx.phrase.upsert({
    where: {
      userId_languageCode_canonicalKey: {
        userId: input.userId,
        languageCode: mutation.languageCode,
        canonicalKey: mutation.normalizedText,
      },
    },
    create: {
      userId: input.userId,
      languageCode: mutation.languageCode,
      canonicalText: mutation.surfaceText.trim(),
      canonicalKey: mutation.normalizedText,
      status: "pending_normalization",
      normalizerVersion: mutation.normalizerVersion,
    },
    update: {},
  });
  await tx.phraseVariant.upsert({
    where: {
      phraseId_normalizedText: {
        phraseId: phrase.id,
        normalizedText: mutation.normalizedText,
      },
    },
    create: {
      phraseId: phrase.id,
      userId: input.userId,
      languageCode: mutation.languageCode,
      surfaceText: mutation.surfaceText,
      normalizedText: mutation.normalizedText,
      source: "observed_cloze",
      normalizerVersion: mutation.normalizerVersion,
    },
    update: { source: "observed_cloze" },
  });
  await tx.phraseOccurrence.upsert({
    where: {
      phraseId_cardId_sourceField_segmentKey_startUtf16_endUtf16: {
        phraseId: phrase.id,
        cardId: input.cardId,
        sourceField: "ai_expression",
        segmentKey: mutation.segmentId,
        startUtf16: mutation.startUtf16,
        endUtf16: mutation.endUtf16,
      },
    },
    create: {
      phraseId: phrase.id,
      userId: input.userId,
      cardId: input.cardId,
      cardCreatedAt: mutation.cardCreatedAt,
      sourceField: "ai_expression",
      segmentId: mutation.segmentId,
      segmentKey: mutation.segmentId,
      startUtf16: mutation.startUtf16,
      endUtf16: mutation.endUtf16,
      surfaceText: mutation.surfaceText,
      matchType: "normalized",
      clozeBlankId: mutation.clozeBlankId,
    },
    update: {
      surfaceText: mutation.surfaceText,
      matchType: "normalized",
      clozeBlankId: mutation.clozeBlankId,
    },
  });
  const inputVersion = `${mutation.normalizerVersion}:${phrase.id}`;
  await tx.cardEnrichmentJob.upsert({
    where: {
      userId_sourceKind_sourceId_jobType_inputVersion: {
        userId: input.userId,
        sourceKind: "card",
        sourceId: input.cardId,
        jobType: "normalize_phrase",
        inputVersion,
      },
    },
    create: {
      userId: input.userId,
      sourceKind: "card",
      sourceId: input.cardId,
      jobType: "normalize_phrase",
      inputHash: mutation.inputHash,
      inputVersion,
      payload: { phraseId: phrase.id, schemaVersion: 1 },
    },
    update: {},
  });
}

function toEntry(row: any): CardEntryEntity {
  return {
    id: row.id,
    userId: row.userId,
    dateKey: row.dateKey,
    originalText: row.originalText ?? null,
    rewrittenText: row.rewrittenText ?? null,
    languageCode: row.languageCode,
    appLocaleSnapshot: normalizeAppLocale(row.appLocaleSnapshot),
    promptDifficultySnapshot: row.promptDifficultySnapshot,
    promptVersion: row.promptVersion,
    status: row.status as CardEntryStatus,
    clientId: row.clientId,
    inputChars: row.inputChars,
    outputChars: row.outputChars,
    isSample: Boolean(row.isSample),
    topic: row.topic ?? null,
    topicEditedAt: row.topicEditedAt ?? null,
    collectionId: row.collectionId ?? null,
    publishedAt: row.publishedAt ?? null,
    processingAt: row.processingAt ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null,
    workerId: row.workerId ?? null,
    failedAt: row.failedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    segments: Array.isArray(row.segments) ? row.segments.map(toSegment) : [],
    image: row.image ? toImageAsset(row.image) : null,
  };
}

function toSegment(row: any): CardSegmentEntity {
  return {
    id: row.id,
    entryId: row.entryId,
    ordinal: row.ordinal,
    text: row.text,
    startUtf16: row.startUtf16,
    endUtf16: row.endUtf16,
    createdAt: row.createdAt,
  };
}

function normalizeAppLocale(value: unknown): AppLocale {
  return value === "zh-TW" || value === "en-US" || value === "ja-JP" ? value : "zh-CN";
}

function sampleRows(languageCode: string, appLocale: AppLocale): Array<{ originalText: string; rewrittenText: string; topic: string }> {
  if (!isTargetLanguageCode(languageCode)) throw new Error("CARD_LANGUAGE_UNSUPPORTED");
  const topics = appLocale === "ja-JP"
    ? ["仕事帰りの散歩", "思ったよりおいしい夕食"]
    : appLocale === "en-US"
      ? ["A relaxing walk home", "A surprisingly good dinner"]
      : ["下班后的散步", "意外好吃的晚饭"];
  return CARD_SAMPLE_ROWS[languageCode].map((row, index) => ({ ...row, topic: topics[index]! }));
}

const CARD_SAMPLE_ROWS: Record<TargetLanguageCode, Array<{ originalText: string; rewrittenText: string }>> = {
  "ja-JP": [
      { originalText: "下班路上风很舒服，我慢慢走回了家。", rewrittenText: "仕事帰りの風が気持ちよくて、ゆっくり歩いて帰った。" },
      { originalText: "今天给自己做了一顿简单的晚饭，意外地很好吃。", rewrittenText: "今日は簡単な晩ごはんを作ったけど、思ったよりおいしかった。" },
  ],
  "en-US": [
    { originalText: "下班路上风很舒服，我慢慢走回了家。", rewrittenText: "The breeze felt so nice after work, so I took my time walking home." },
    { originalText: "今天给自己做了一顿简单的晚饭，意外地很好吃。", rewrittenText: "I made myself a simple dinner today, and it turned out surprisingly good." },
  ],
};

function toPracticeState(row: any): CardPracticeStateEntity {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    clozeState: row.clozeState ?? null,
    clozeVersion: row.clozeVersion ?? 0,
    clozeLastResult: row.clozeLastResult ?? null,
    clozeNextReviewAt: row.clozeNextReviewAt ?? null,
    clozeCorrectStreak: row.clozeCorrectStreak ?? 0,
    dictationCompleted: row.dictationLastResult != null,
    dictationLastResult: row.dictationLastResult ?? null,
    dictationCorrectStreak: row.dictationCorrectStreak ?? 0,
    dictationNextReviewAt: row.dictationNextReviewAt ?? null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function toSpeechAsset(row: any): CardSpeechAssetEntity {
  return {
    id: row.id,
    userId: row.userId,
    entryId: row.entryId ?? null,
    segmentId: row.segmentId ?? null,
    sourceKind: row.sourceKind,
    cacheKey: row.cacheKey,
    provider: row.provider,
    voiceCode: row.voiceCode,
    languageCode: row.languageCode,
    sourceText: row.sourceText,
    sourceTextHash: row.sourceTextHash,
    objectKey: row.objectKey,
    objectUrl: row.objectUrl ?? null,
    objectUrlExpiresAt: row.objectUrlExpiresAt ?? null,
    durationMs: row.durationMs ?? null,
    wordMarks: row.wordMarks ?? null,
    sentenceMarks: row.sentenceMarks ?? null,
  };
}

function toImageAsset(row: any): CardImageAssetEntity {
  return {
    id: row.id,
    userId: row.userId,
    entryId: row.entryId ?? null,
    status: row.status,
    originalObjectKey: row.originalObjectKey,
    uploadObjectKey: row.uploadObjectKey ?? null,
    thumbnailObjectKey: row.thumbnailObjectKey ?? null,
    thumbnailStatus: row.thumbnailStatus,
    thumbnailVersion: row.thumbnailVersion,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    width: row.width,
    height: row.height,
    fileMd5: row.fileMd5 ?? null,
    moderationRequestId: row.moderationRequestId ?? null,
    moderationSuggestion: row.moderationSuggestion ?? null,
    moderationLabel: row.moderationLabel ?? null,
    expiresAt: row.expiresAt,
    claimedAt: row.claimedAt ?? null,
  };
}
