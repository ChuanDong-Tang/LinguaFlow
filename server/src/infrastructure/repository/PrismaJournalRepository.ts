import type {
  CompleteJournalEntryInput,
  CreateQueuedJournalEntryInput,
  JournalEntryEntity,
  JournalRepository,
  JournalPracticeStateEntity,
  JournalSpeechAssetEntity,
  JournalImageAssetEntity,
  JournalSegmentEntity,
} from "@lf/core/ports/repository/JournalRepository.js";
import type { JournalEntryStatus } from "@lf/core/types/journal.js";
import { countGraphemes } from "@lf/core/text/grapheme.js";

type PrismaJournalClient = {
  journalEntry: {
    create: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  journalRewriteSegment: {
    deleteMany: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
  };
  journalImageAsset: {
    create: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  journalLegacyHidden: {
    upsert: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
  };
  journalPracticeState: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    upsert: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
  };
  journalSpeechAsset: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<{ count: number }>;
  };
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

const includeSegments = {
  segments: { orderBy: { ordinal: "asc" } },
  image: true,
} as const;

export class PrismaJournalRepository implements JournalRepository {
  constructor(private readonly prisma: PrismaJournalClient) {}

  async hasAnyByUser(userId: string): Promise<boolean> {
    return Boolean(await this.prisma.journalEntry.findFirst({
      where: { userId },
      select: { id: true },
    }));
  }

  async createSamples(input: {
    userId: string;
    dateKey: string;
    languageCode: string;
    promptDifficultySnapshot: string;
    promptVersion: string;
  }): Promise<JournalEntryEntity[]> {
    const samples = sampleRows(input.languageCode);
    return this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.createMany({
        data: samples.map((sample, index) => ({
          userId: input.userId,
          dateKey: input.dateKey,
          originalText: sample.originalText,
          rewrittenText: sample.rewrittenText,
          languageCode: input.languageCode,
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
      const rows = await tx.journalEntry.findMany({
        where: { userId: input.userId, clientId: { in: ["sample:v1:1", "sample:v1:2"] } },
        orderBy: [{ createdAt: "asc" }],
        include: includeSegments,
      });
      for (const row of rows) {
        const sample = samples[Number(row.clientId.slice(-1)) - 1];
        if (!sample) continue;
        await tx.journalRewriteSegment.createMany({
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
      const completed = await tx.journalEntry.findMany({
        where: { userId: input.userId, clientId: { in: ["sample:v1:1", "sample:v1:2"] }, status: "completed" },
        orderBy: [{ createdAt: "asc" }],
        include: includeSegments,
      });
      return completed.map(toEntry);
    });
  }

  async createQueued(input: CreateQueuedJournalEntryInput): Promise<JournalEntryEntity> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.journalEntry.create({
        data: {
          userId: input.userId,
          dateKey: input.dateKey,
          originalText: input.originalText,
          languageCode: input.languageCode,
          promptDifficultySnapshot: input.promptDifficultySnapshot,
          promptVersion: input.promptVersion,
          clientId: input.clientId,
          inputChars: input.inputChars,
          status: "queued",
        },
        include: includeSegments,
      });
      if (input.imageUploadId) {
        const claimed = await tx.journalImageAsset.updateMany({
          where: {
            id: input.imageUploadId,
            userId: input.userId,
            entryId: null,
            status: { in: ["approved", "approved_with_review"] },
            expiresAt: { gt: new Date() },
          },
          data: { entryId: row.id, claimedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("JOURNAL_IMAGE_NOT_READY");

        // `row` was loaded before the image was claimed, so its included image
        // relation is stale. Reload it so the create response can already carry
        // the thumbnail while the rewrite task is still queued/processing.
        const rowWithImage = await tx.journalEntry.findUnique({
          where: { id: row.id },
          include: includeSegments,
        });
        if (!rowWithImage) throw new Error("JOURNAL_ENTRY_NOT_FOUND_AFTER_CREATE");
        return toEntry(rowWithImage);
      }
      return toEntry(row);
    });
  }

  async findByUserClientId(userId: string, clientId: string): Promise<JournalEntryEntity | null> {
    const row = await this.prisma.journalEntry.findFirst({
      where: { userId, clientId },
      include: includeSegments,
    });
    return row ? toEntry(row) : null;
  }

  async findByIdForUser(entryId: string, userId: string): Promise<JournalEntryEntity | null> {
    const row = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, userId },
      include: includeSegments,
    });
    return row ? toEntry(row) : null;
  }

  async findActiveByUser(userId: string): Promise<JournalEntryEntity | null> {
    const row = await this.prisma.journalEntry.findFirst({
      where: { userId, status: { in: ["queued", "processing"] } },
      orderBy: [{ createdAt: "asc" }],
      include: includeSegments,
    });
    return row ? toEntry(row) : null;
  }

  async listByUserDate(userId: string, dateKey: string, limit: number): Promise<JournalEntryEntity[]> {
    const rows = await this.prisma.journalEntry.findMany({
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
    const rows = await this.prisma.journalEntry.findMany({
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

  async listRecentCompleted(userId: string, beforeDateKey: string, limit: number): Promise<JournalEntryEntity[]> {
    const rows = await this.prisma.journalEntry.findMany({
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

  async claimNextQueued(workerId: string, leaseExpiresAt: Date): Promise<JournalEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT "id"
           FROM "journal_entries"
          WHERE "status" = 'queued'
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      )) as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) return null;
      const row = await tx.journalEntry.update({
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
    const result = await this.prisma.journalEntry.updateMany({
      where: { id: entryId, workerId, status: "processing" },
      data: { leaseExpiresAt },
    });
    return result.count === 1;
  }

  async complete(input: CompleteJournalEntryInput): Promise<JournalEntryEntity> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.journalEntry.updateMany({
        where: { id: input.entryId, workerId: input.workerId, status: "processing" },
        data: {
          rewrittenText: input.rewrittenText,
          outputChars: input.outputChars,
          status: "completed",
          publishedAt: input.publishedAt,
          leaseExpiresAt: null,
          workerId: null,
        },
      });
      if (changed.count !== 1) throw new Error("JOURNAL_TASK_LEASE_LOST");
      await tx.journalRewriteSegment.deleteMany({ where: { entryId: input.entryId } });
      if (input.segments.length) {
        await tx.journalRewriteSegment.createMany({
          data: input.segments.map((segment) => ({ entryId: input.entryId, ...segment })),
        });
      }
      const completedEntry = await tx.journalEntry.findFirst({
        where: { id: input.entryId },
        select: { userId: true, isSample: true },
      });
      if (completedEntry && !completedEntry.isSample) {
        const visibleSamples = await tx.journalEntry.findMany({
          where: { userId: completedEntry.userId, isSample: true, status: "completed" },
          select: { id: true },
        });
        const sampleIds = visibleSamples.map((sample: { id: string }) => sample.id);
        if (sampleIds.length) {
          await tx.journalEntry.updateMany({
            where: { id: { in: sampleIds } },
            data: {
              status: "deleted",
              originalText: null,
              rewrittenText: null,
              deletedAt: input.publishedAt,
            },
          });
          await tx.journalRewriteSegment.deleteMany({ where: { entryId: { in: sampleIds } } });
        }
      }
      const row = await tx.journalEntry.findFirst({
        where: { id: input.entryId },
        include: includeSegments,
      });
      if (!row) throw new Error("JOURNAL_ENTRY_NOT_FOUND");
      return toEntry(row);
    });
  }

  async markFailedAndScrub(
    entryId: string,
    workerId: string | null,
    failedAt: Date,
    leaseExpiredBefore?: Date,
  ): Promise<JournalEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.journalEntry.updateMany({
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
      await tx.journalRewriteSegment.deleteMany({ where: { entryId } });
      await tx.journalImageAsset.updateMany({
        where: { entryId },
        data: { entryId: null, status: "cleanup_pending" },
      });
      const row = await tx.journalEntry.findFirst({
        where: { id: entryId },
        include: includeSegments,
      });
      return row ? toEntry(row) : null;
    });
  }

  async listExpiredProcessing(now: Date, limit: number): Promise<JournalEntryEntity[]> {
    const rows = await this.prisma.journalEntry.findMany({
      where: { status: "processing", leaseExpiresAt: { lt: now } },
      orderBy: [{ leaseExpiresAt: "asc" }],
      take: limit,
      include: includeSegments,
    });
    return rows.map(toEntry);
  }

  async markDeleted(entryId: string, userId: string, deletedAt: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.journalEntry.updateMany({
        where: { id: entryId, userId, status: "completed" },
        data: {
          status: "deleted",
          originalText: null,
          rewrittenText: null,
          deletedAt,
        },
      });
      if (result.count !== 1) return false;
      await tx.journalRewriteSegment.deleteMany({ where: { entryId } });
      await tx.journalImageAsset.updateMany({
        where: { entryId },
        data: { entryId: null, status: "cleanup_pending" },
      });
      await tx.journalPracticeState.deleteMany({
        where: { userId, sourceKind: "journal", sourceId: entryId },
      });
      await tx.journalSpeechAsset.updateMany({
        where: {
          entryId,
          sourceKind: { in: ["review_segment", "dictation_sentence"] },
        },
        data: { status: "cleanup_pending", objectUrl: null, objectUrlExpiresAt: null },
      });
      return true;
    });
  }

  async hideLegacy(userId: string, assistantMessageId: string): Promise<void> {
    await this.prisma.journalLegacyHidden.upsert({
      where: { userId_assistantMessageId: { userId, assistantMessageId } },
      create: { userId, assistantMessageId },
      update: {},
    });
  }

  async isLegacyHidden(userId: string, assistantMessageId: string): Promise<boolean> {
    const row = await this.prisma.journalLegacyHidden.findUnique({
      where: { userId_assistantMessageId: { userId, assistantMessageId } },
      select: { id: true },
    });
    return Boolean(row);
  }

  async findPracticeState(
    userId: string,
    sourceKind: "journal" | "legacy_cloud",
    sourceId: string,
  ): Promise<JournalPracticeStateEntity | null> {
    const row = await this.prisma.journalPracticeState.findUnique({
      where: {
        userId_sourceKind_sourceId_scopeKey: { userId, sourceKind, sourceId, scopeKey: "record" },
      },
    });
    return row ? toPracticeState(row) : null;
  }

  async saveDictationResult(input: {
    userId: string;
    sourceKind: "journal" | "legacy_cloud";
    sourceId: string;
    result: "correct" | "incorrect" | "revealed";
    practicedAt: Date;
    nextReviewAt: Date;
    correctStreak: number;
  }): Promise<JournalPracticeStateEntity> {
    const row = await this.prisma.journalPracticeState.upsert({
      where: {
        userId_sourceKind_sourceId_scopeKey: {
          userId: input.userId,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          scopeKey: "record",
        },
      },
      create: {
        userId: input.userId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        scopeKey: "record",
        dictationCompleted: true,
        dictationLastPracticedAt: input.practicedAt,
        dictationLastResult: input.result,
        dictationPracticeCount: 1,
        dictationCorrectStreak: input.correctStreak,
        dictationNextReviewAt: input.nextReviewAt,
        dictationCompletedAt: input.practicedAt,
      },
      update: {
        dictationCompleted: true,
        dictationLastPracticedAt: input.practicedAt,
        dictationLastResult: input.result,
        dictationPracticeCount: { increment: 1 },
        dictationCorrectStreak: input.correctStreak,
        dictationNextReviewAt: input.nextReviewAt,
        dictationCompletedAt: input.practicedAt,
      },
    });
    return toPracticeState(row);
  }

  async saveClozeState(input: {
    userId: string;
    sourceKind: "journal" | "legacy_cloud";
    sourceId: string;
    expectedVersion: number;
    state: unknown;
    result: "correct" | "incorrect" | "revealed" | null;
    practicedAt: Date | null;
    nextReviewAt: Date | null;
    correctStreak: number;
  }): Promise<JournalPracticeStateEntity | null> {
    const key = {
      userId: input.userId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      scopeKey: "record",
    };
    const practiceData = input.result ? {
      clozeLastPracticedAt: input.practicedAt,
      clozeLastResult: input.result,
      clozePracticeCount: { increment: 1 },
      clozeCorrectStreak: input.correctStreak,
      clozeNextReviewAt: input.nextReviewAt,
      ...(input.result === "correct" ? { clozeCompletedAt: input.practicedAt } : {}),
    } : {};
    if (input.expectedVersion === 0) {
      const changed = await this.prisma.journalPracticeState.updateMany({
        where: { ...key, clozeVersion: 0 },
        data: { clozeState: input.state, clozeVersion: { increment: 1 }, ...practiceData },
      });
      if (changed.count === 1) {
        return this.findPracticeState(input.userId, input.sourceKind, input.sourceId);
      }
      try {
        const row = await this.prisma.journalPracticeState.create({
          data: {
            ...key,
            clozeState: input.state,
            clozeVersion: 1,
            ...(input.result ? {
              clozeLastPracticedAt: input.practicedAt,
              clozeLastResult: input.result,
              clozePracticeCount: 1,
              clozeCorrectStreak: input.correctStreak,
              clozeNextReviewAt: input.nextReviewAt,
              ...(input.result === "correct" ? { clozeCompletedAt: input.practicedAt } : {}),
            } : {}),
          },
        });
        return toPracticeState(row);
      } catch (error) {
        if (isUniqueConstraintError(error)) return null;
        throw error;
      }
    }
    const changed = await this.prisma.journalPracticeState.updateMany({
      where: { ...key, clozeVersion: input.expectedVersion },
      data: { clozeState: input.state, clozeVersion: { increment: 1 }, ...practiceData },
    });
    if (changed.count !== 1) return null;
    return this.findPracticeState(input.userId, input.sourceKind, input.sourceId);
  }

  async deleteFailedTombstonesBefore(before: Date, limit: number): Promise<number> {
    const rows = await this.prisma.journalEntry.findMany({
      where: { status: "failed", failedAt: { lt: before }, originalText: null, rewrittenText: null },
      orderBy: [{ failedAt: "asc" }],
      take: Math.max(1, limit),
      select: { id: true },
    });
    if (!rows.length) return 0;
    const result = await this.prisma.journalEntry.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, status: "failed" },
    });
    return result.count;
  }

  async findReadySpeechAsset(cacheKey: string): Promise<JournalSpeechAssetEntity | null> {
    const row = await this.prisma.journalSpeechAsset.findUnique({ where: { cacheKey } });
    if (row?.status !== "ready") return null;
    const touched = await this.prisma.journalSpeechAsset.update({
      where: { id: row.id },
      data: { lastAccessedAt: new Date() },
    });
    return toSpeechAsset(touched);
  }

  async saveReadySpeechAsset(input: Omit<JournalSpeechAssetEntity, "id">): Promise<JournalSpeechAssetEntity> {
    const row = await this.prisma.journalSpeechAsset.upsert({
      where: { cacheKey: input.cacheKey },
      create: { ...input, status: "ready", format: "mp3", lastAccessedAt: new Date() },
      update: {
        ...input,
        status: "ready",
        errorCode: null,
        errorMessage: null,
        lastAccessedAt: new Date(),
      },
    });
    return toSpeechAsset(row);
  }

  async updateSpeechAssetUrl(
    id: string,
    objectUrl: string | null,
    objectUrlExpiresAt: Date | null,
  ): Promise<JournalSpeechAssetEntity> {
    const row = await this.prisma.journalSpeechAsset.update({
      where: { id },
      data: { objectUrl, objectUrlExpiresAt, lastAccessedAt: new Date() },
    });
    return toSpeechAsset(row);
  }

  async listSpeechAssetsForCleanup(staleDictionaryBefore: Date, limit: number): Promise<JournalSpeechAssetEntity[]> {
    const rows = await this.prisma.journalSpeechAsset.findMany({
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
    const result = await this.prisma.journalSpeechAsset.deleteMany({
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
    const result = await this.prisma.journalSpeechAsset.updateMany({
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

  async createImageUpload(input: {
    id: string;
    userId: string;
    objectKey: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    expiresAt: Date;
  }): Promise<JournalImageAssetEntity> {
    const row = await this.prisma.journalImageAsset.create({
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
  }

  async findImageUpload(id: string, userId: string): Promise<JournalImageAssetEntity | null> {
    const row = await this.prisma.journalImageAsset.findFirst({ where: { id, userId } });
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
  }): Promise<JournalImageAssetEntity | null> {
    const changed = await this.prisma.journalImageAsset.updateMany({
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

  async markImageUploadCleanup(id: string, userId: string): Promise<JournalImageAssetEntity | null> {
    const changed = await this.prisma.journalImageAsset.updateMany({
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
  }): Promise<JournalImageAssetEntity | null> {
    const changed = await this.prisma.journalImageAsset.updateMany({
      where: { id: input.id, userId: input.userId },
      data: {
        thumbnailObjectKey: input.thumbnailObjectKey,
        thumbnailStatus: "ready",
        thumbnailVersion: input.thumbnailVersion,
      },
    });
    return changed.count === 1 ? this.findImageUpload(input.id, input.userId) : null;
  }

  async listImageAssetsForCleanup(now: Date, limit: number): Promise<JournalImageAssetEntity[]> {
    const rows = await this.prisma.journalImageAsset.findMany({
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
    const result = await this.prisma.journalImageAsset.deleteMany({ where: { id, entryId: null } });
    return result.count === 1;
  }

  async listImageUploadObjectsForCleanup(limit: number): Promise<JournalImageAssetEntity[]> {
    const rows = await this.prisma.journalImageAsset.findMany({
      where: { status: { in: ["approved", "approved_with_review"] }, uploadObjectKey: { not: null } },
      orderBy: [{ updatedAt: "asc" }],
      take: Math.max(1, limit),
    });
    return rows.map(toImageAsset);
  }

  async clearImageUploadObjectKey(id: string, objectKey: string): Promise<boolean> {
    const result = await this.prisma.journalImageAsset.updateMany({
      where: { id, uploadObjectKey: objectKey },
      data: { uploadObjectKey: null },
    });
    return result.count === 1;
  }

  async replaceEntryImage(input: {
    entryId: string;
    userId: string;
    imageUploadId: string | null;
  }): Promise<JournalEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed" },
        include: includeSegments,
      });
      if (!entry) return null;
      if (entry.image?.id === input.imageUploadId) return toEntry(entry);
      await tx.journalImageAsset.updateMany({
        where: { entryId: entry.id },
        data: { entryId: null, status: "cleanup_pending" },
      });
      if (input.imageUploadId) {
        const claimed = await tx.journalImageAsset.updateMany({
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
        if (claimed.count !== 1) throw new Error("JOURNAL_IMAGE_NOT_READY");
      }
      const updated = await tx.journalEntry.findFirst({
        where: { id: entry.id },
        include: includeSegments,
      });
      return updated ? toEntry(updated) : null;
    });
  }
}

function toEntry(row: any): JournalEntryEntity {
  return {
    id: row.id,
    userId: row.userId,
    dateKey: row.dateKey,
    originalText: row.originalText ?? null,
    rewrittenText: row.rewrittenText ?? null,
    languageCode: row.languageCode,
    promptDifficultySnapshot: row.promptDifficultySnapshot,
    promptVersion: row.promptVersion,
    status: row.status as JournalEntryStatus,
    clientId: row.clientId,
    inputChars: row.inputChars,
    outputChars: row.outputChars,
    isSample: Boolean(row.isSample),
    sampleImageKey: row.sampleImageKey ?? null,
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

function toSegment(row: any): JournalSegmentEntity {
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

function sampleRows(languageCode: string): Array<{ originalText: string; rewrittenText: string }> {
  if (languageCode === "ja-JP") {
    return [
      { originalText: "下班路上风很舒服，我慢慢走回了家。", rewrittenText: "仕事帰りの風が気持ちよくて、ゆっくり歩いて帰った。" },
      { originalText: "今天给自己做了一顿简单的晚饭，意外地很好吃。", rewrittenText: "今日は簡単な晩ごはんを作ったけど、思ったよりおいしかった。" },
    ];
  }
  return [
    { originalText: "下班路上风很舒服，我慢慢走回了家。", rewrittenText: "The breeze felt so nice after work, so I took my time walking home." },
    { originalText: "今天给自己做了一顿简单的晚饭，意外地很好吃。", rewrittenText: "I made myself a simple dinner today, and it turned out surprisingly good." },
  ];
}

function toPracticeState(row: any): JournalPracticeStateEntity {
  return {
    id: row.id,
    userId: row.userId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    clozeState: row.clozeState ?? null,
    clozeVersion: row.clozeVersion ?? 0,
    clozeLastResult: row.clozeLastResult ?? null,
    clozeNextReviewAt: row.clozeNextReviewAt ?? null,
    clozeCorrectStreak: row.clozeCorrectStreak ?? 0,
    dictationCompleted: Boolean(row.dictationCompleted),
    dictationLastResult: row.dictationLastResult ?? null,
    dictationPracticeCount: row.dictationPracticeCount ?? 0,
    dictationCorrectStreak: row.dictationCorrectStreak ?? 0,
    dictationNextReviewAt: row.dictationNextReviewAt ?? null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function toSpeechAsset(row: any): JournalSpeechAssetEntity {
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

function toImageAsset(row: any): JournalImageAssetEntity {
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
    focalPointX: row.focalPointX ?? null,
    focalPointY: row.focalPointY ?? null,
  };
}
