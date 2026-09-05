import type {
  CompleteCardEntryInput,
  CreateDirectCardEntryInput,
  CreateQueuedCardEntryInput,
  CardEntryEntity,
  CardRepository,
  CardPracticeStateEntity,
  CardSpeechAssetEntity,
  CardImageAssetEntity,
  CardSegmentEntity,
  CardContentSegmentEntity,
  CardContentSegmentWrite,
  CardContentPracticeStateEntity,
  CardLearningContentType,
} from "@lf/core/ports/repository/CardRepository.js";
import type { AppLocale } from "@lf/core/ports/repository/UserPreferenceRepository.js";
import type { CardEntryStatus } from "@lf/core/types/cardRecord.js";
import { buildCardEmbeddingInput } from "@lf/core/text/cardEmbedding.js";
import { countGraphemes } from "@lf/core/text/grapheme.js";
import { countCardCharacters } from "@lf/core/text/cardText.js";
import { isTargetLanguageCode, type TargetLanguageCode } from "@lf/core/language/targetLanguages.js";
import { CARD_TOPIC_PROMPT_VERSION } from "@lf/core/Prompts/cardTopicPrompt.js";
import {
  CARD_IMAGE_DESCRIPTION_JOB_TYPE,
  CARD_IMAGE_DESCRIPTION_PAYLOAD_SCHEMA_VERSION,
  CARD_IMAGE_DESCRIPTION_PROMPT_VERSION,
  CARD_IMAGE_DESCRIPTION_RESULT_VERSION,
  CARD_IMAGE_DESCRIPTION_SOURCE_KIND,
  cardImageDescriptionInputVersion,
} from "@lf/core/Prompts/cardImageDescriptionPrompt.js";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

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
  cardCollection: {
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
  cardRewriteSegment: {
    deleteMany: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
  };
  cardContentSegment: {
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany: (args: any) => Promise<any>;
    createMany: (args: any) => Promise<any>;
  };
  cardContentPracticeState: {
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    upsert: (args: any) => Promise<any>;
    deleteMany: (args: any) => Promise<any>;
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
    findMany: (args: any) => Promise<any[]>;
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
  contentSegments: { orderBy: [{ contentType: "asc" }, { ordinal: "asc" }] },
  images: { orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }] },
} as const;

export class PrismaCardRepository implements CardRepository {
  constructor(private readonly prisma: PrismaCardClient) {}

  async hideSamplesIfRealCardExists(userId: string, hiddenAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const realCard = await tx.card.findFirst({
        where: { userId, isSample: false, status: "completed", deletedAt: null },
        select: { id: true },
      });
      if (realCard) await hideCompletedSamples(tx, userId, hiddenAt);
    });
  }

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
    offset = 0,
    fromDateKey?: string,
  ): Promise<CardEntryEntity[]> {
    let collectionWhere: { collectionId: null | { in: string[] } } | Record<string, never> = {};
    if (collectionId === null) {
      collectionWhere = { collectionId: null };
    } else if (typeof collectionId === "string") {
      const collections = await this.prisma.cardCollection.findMany({
        where: { userId },
        select: { id: true, parentId: true },
      });
      const included = new Set([collectionId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const collection of collections) {
          if (collection.parentId && included.has(collection.parentId) && !included.has(collection.id)) {
            included.add(collection.id);
            changed = true;
          }
        }
      }
      collectionWhere = { collectionId: { in: Array.from(included) } };
    }
    return this.prisma.card.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { notIn: ["failed", "deleted"] },
        ...collectionWhere,
        ...(fromDateKey ? { dateKey: { gte: fromDateKey } } : {}),
      },
      include: includeSegments,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: Math.max(0, offset),
    });
  }

  async listPageByUser(input: {
    userId: string;
    collectionId: string | null | undefined;
    dateKey?: string;
    fromDateKey?: string;
    sortDirection?: "asc" | "desc";
    limit: number;
    cursor?: { createdAt: Date; id: string };
  }): Promise<CardEntryEntity[]> {
    let collectionWhere: { collectionId: null | { in: string[] } } | Record<string, never> = {};
    if (input.collectionId === null) {
      collectionWhere = { collectionId: null };
    } else if (typeof input.collectionId === "string") {
      const collections = await this.prisma.cardCollection.findMany({
        where: { userId: input.userId },
        select: { id: true, parentId: true },
      });
      const included = new Set([input.collectionId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const collection of collections) {
          if (collection.parentId && included.has(collection.parentId) && !included.has(collection.id)) {
            included.add(collection.id);
            changed = true;
          }
        }
      }
      collectionWhere = { collectionId: { in: [...included] } };
    }
    const rows = await this.prisma.card.findMany({
      where: {
        userId: input.userId,
        deletedAt: null,
        status: { notIn: ["failed", "deleted"] },
        ...collectionWhere,
        ...(input.dateKey ? { dateKey: input.dateKey } : input.fromDateKey ? { dateKey: { gte: input.fromDateKey } } : {}),
        ...(input.cursor ? {
          OR: [
            { createdAt: { [input.sortDirection === "asc" ? "gt" : "lt"]: input.cursor.createdAt } },
            { createdAt: input.cursor.createdAt, id: { [input.sortDirection === "asc" ? "gt" : "lt"]: input.cursor.id } },
          ],
        } : {}),
      },
      include: includeSegments,
      orderBy: [{ createdAt: input.sortDirection ?? "desc" }, { id: input.sortDirection ?? "desc" }],
      take: input.limit,
    });
    return rows.map(toEntry);
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
          originalContentHash: sampleContentHash(sample.originalText),
          rewrittenText: sample.rewrittenText,
          rewrittenLanguageCode: input.languageCode,
          rewrittenSourceHash: sampleContentHash(sample.originalText),
          topic: sample.topic,
          languageCode: input.languageCode,
          appLocaleSnapshot: input.appLocaleSnapshot,
          promptDifficultySnapshot: input.promptDifficultySnapshot,
          promptVersion: input.promptVersion,
          clientId: `sample:v1:${index + 1}`,
          inputChars: countCardCharacters(sample.originalText),
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
        await syncContentSegments(tx, row.id, [
          {
            contentType: "original",
            contentVersion: `sample:v1:original:${row.clientId}`,
            segments: [{ ordinal: 0, text: sample.originalText, startUtf16: 0, endUtf16: sample.originalText.length }],
          },
          {
            contentType: "rewrite",
            contentVersion: `sample:v1:rewrite:${row.clientId}`,
            segments: [{ ordinal: 0, text: sample.rewrittenText, startUtf16: 0, endUtf16: sample.rewrittenText.length }],
          },
        ]);
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
      if (input.collectionId && !await tx.cardCollection.findFirst({ where: { id: input.collectionId, userId: input.userId }, select: { id: true } })) throw new Error("CARD_COLLECTION_NOT_FOUND");
      const row = await tx.card.create({
        data: {
          userId: input.userId,
          collectionId: input.collectionId,
          dateKey: input.dateKey,
          title: input.title,
          originalText: input.originalText,
          originalContentHash: input.originalContentHash,
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

  async createDirect(input: CreateDirectCardEntryInput): Promise<CardEntryEntity> {
    return this.prisma.$transaction(async (tx) => {
      if (input.collectionId && !await tx.cardCollection.findFirst({ where: { id: input.collectionId, userId: input.userId }, select: { id: true } })) throw new Error("CARD_COLLECTION_NOT_FOUND");
      const row = await tx.card.create({
        data: {
          userId: input.userId,
          collectionId: input.collectionId,
          dateKey: input.dateKey,
          title: input.title,
          originalText: input.originalText,
          originalContentHash: input.originalContentHash,
          rewrittenText: input.rewrittenText,
          rewrittenLanguageCode: input.rewrittenLanguageCode,
          rewrittenSourceHash: input.rewrittenSourceHash,
          translationText: input.translationText,
          translationLanguageCode: input.translationLanguageCode,
          translationSourceHash: input.translationSourceHash,
          replyText: input.replyText,
          replyLanguageCode: input.replyLanguageCode,
          replySourceHash: input.replySourceHash,
          languageCode: input.languageCode,
          appLocaleSnapshot: input.appLocaleSnapshot,
          promptDifficultySnapshot: input.promptDifficultySnapshot,
          promptVersion: input.promptVersion,
          clientId: input.clientId,
          inputChars: countCardCharacters(input.originalText ?? input.rewrittenText ?? ""),
          outputChars: countGraphemes(input.rewrittenText ?? ""),
          status: "completed",
          publishedAt: input.createdAt ?? new Date(),
          ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
        },
        include: includeSegments,
      });
      if (input.segments.length) {
        await tx.cardRewriteSegment.createMany({
          data: input.segments.map((segment) => ({ entryId: row.id, ...segment })),
        });
      }
      await syncContentSegments(tx, row.id, input.contentSegments);
      await hideCompletedSamples(tx, input.userId, input.createdAt ?? new Date());
      if (input.originalText && input.originalContentHash) {
        await enqueueTopicGeneration(tx, {
          userId: input.userId,
          cardId: row.id,
          inputHash: input.originalContentHash,
        });
        const embeddingInput = buildCardEmbeddingInput(input.originalText, input.rewrittenText ?? "");
        const embeddingHash = createHash("sha256").update(embeddingInput).digest("hex");
        await enqueueEmbeddingGeneration(tx, {
          userId: input.userId,
          cardId: row.id,
          inputHash: embeddingHash,
          inputVersion: `card_embedding_input_v1:${embeddingHash}`,
        });
        await enqueuePhraseEnrichment(tx, {
          userId: input.userId,
          cardId: row.id,
          inputHash: embeddingHash,
        });
      }
      for (const [ordinal, imageUploadId] of input.imageUploadIds.entries()) {
        const claimed = await tx.cardImageAsset.updateMany({
          where: {
            id: imageUploadId,
            userId: input.userId,
            entryId: null,
            status: { in: ["approved", "approved_with_review"] },
            thumbnailStatus: "ready",
            expiresAt: { gt: new Date() },
          },
          data: { entryId: row.id, ordinal, claimedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("CARD_IMAGE_NOT_READY");
        await enqueueImageDescriptionGeneration(tx, input.userId, row.id, imageUploadId, 100);
      }
      const created = await tx.card.findFirst({ where: { id: row.id }, include: includeSegments });
      if (!created) throw new Error("CARD_ENTRY_NOT_FOUND_AFTER_CREATE");
      return toEntry(created);
    });
  }

  async updateContent(input: {
    entryId: string;
    userId: string;
    collectionId: string | null;
    expectedOriginalContentHash: string | null;
    title: string | null;
    originalText: string | null;
    originalContentHash: string | null;
    rewrittenText: string | null;
    rewrittenLanguageCode: string | null;
    rewrittenSourceHash: string | null;
    translationText: string | null;
    translationLanguageCode: string | null;
    translationSourceHash: string | null;
    replyText: string | null;
    replyLanguageCode: string | null;
    replySourceHash: string | null;
    segments: Array<{ ordinal: number; text: string; startUtf16: number; endUtf16: number }>;
    contentSegments: CardContentSegmentWrite[];
    clearPractice: boolean;
  }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      if (input.collectionId && !await tx.cardCollection.findFirst({ where: { id: input.collectionId, userId: input.userId }, select: { id: true } })) throw new Error("CARD_COLLECTION_NOT_FOUND");
      const current = await tx.card.findFirst({
        where: {
          id: input.entryId,
          userId: input.userId,
          status: "completed",
          deletedAt: null,
          originalContentHash: input.expectedOriginalContentHash,
        },
        select: { originalText: true, rewrittenText: true, topic: true },
      });
      if (!current) return null;
      const embeddingContentChanged = current.originalText !== input.originalText
        || current.rewrittenText !== input.rewrittenText;
      const topicNeedsRefresh = Boolean(
        input.originalText
        && input.originalContentHash
        && (input.originalContentHash !== input.expectedOriginalContentHash || !current.topic),
      );
      const changed = await tx.card.updateMany({
        where: {
          id: input.entryId,
          userId: input.userId,
          status: "completed",
          deletedAt: null,
          originalContentHash: input.expectedOriginalContentHash,
        },
        data: {
          collectionId: input.collectionId,
          title: input.title,
          originalText: input.originalText,
          originalContentHash: input.originalContentHash,
          rewrittenText: input.rewrittenText,
          rewrittenLanguageCode: input.rewrittenLanguageCode,
          rewrittenSourceHash: input.rewrittenSourceHash,
          translationText: input.translationText,
          translationLanguageCode: input.translationLanguageCode,
          translationSourceHash: input.translationSourceHash,
          ...(current.rewrittenText !== input.rewrittenText ? {
            auxiliarySegments: Prisma.DbNull,
            auxiliaryLanguageCode: null,
            auxiliarySourceHash: null,
          } : {}),
          ...(current.originalText !== input.originalText || current.rewrittenText !== input.rewrittenText ? {
            phraseRecommendations: Prisma.DbNull,
            phraseRecommendationSeenAt: null,
            phraseRecommendationExhaustedAt: null,
            phraseRecommendationPromptVersion: null,
          } : {}),
          replyText: input.replyText,
          replyLanguageCode: input.replyLanguageCode,
          replySourceHash: input.replySourceHash,
          topic: input.originalContentHash !== input.expectedOriginalContentHash ? null : undefined,
          topicEditedAt: input.originalContentHash !== input.expectedOriginalContentHash ? null : undefined,
          inputChars: countCardCharacters(input.originalText ?? input.rewrittenText ?? ""),
          outputChars: countGraphemes(input.rewrittenText ?? ""),
        },
      });
      if (changed.count !== 1) return null;
      await tx.cardRewriteSegment.deleteMany({ where: { entryId: input.entryId } });
      if (input.segments.length) {
        await tx.cardRewriteSegment.createMany({
          data: input.segments.map((segment) => ({ entryId: input.entryId, ...segment })),
        });
      }
      await syncContentSegments(tx, input.entryId, input.contentSegments);
      if (embeddingContentChanged) {
        await tx.cardEmbedding.deleteMany({ where: { cardId: input.entryId, userId: input.userId } });
        // Every indexed occurrence addresses the previous original/rewrite text.
        // Cloze practice is invalidated by the same content change, so rebuild the
        // complete phrase view from the new source instead of keeping stale rows.
        await tx.phraseOccurrence.deleteMany({ where: { cardId: input.entryId, userId: input.userId } });
      }
      if (topicNeedsRefresh) {
        await enqueueTopicGeneration(tx, {
          userId: input.userId,
          cardId: input.entryId,
          inputHash: input.originalContentHash!,
        });
      }
      if (embeddingContentChanged && input.originalText) {
        const embeddingInput = buildCardEmbeddingInput(input.originalText, input.rewrittenText ?? "");
        const inputHash = createHash("sha256").update(embeddingInput).digest("hex");
        await enqueueEmbeddingGeneration(tx, {
          userId: input.userId,
          cardId: input.entryId,
          inputHash,
          inputVersion: `card_embedding_input_v1:${inputHash}`,
        });
        await enqueuePhraseEnrichment(tx, {
          userId: input.userId,
          cardId: input.entryId,
          inputHash,
        });
      }
      if (input.clearPractice) {
        await tx.cardPracticeState.deleteMany({ where: { cardId: input.entryId, userId: input.userId } });
      }
      const updated = await tx.card.findFirst({ where: { id: input.entryId }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async saveAuxiliarySegments(input: {
    entryId: string;
    userId: string;
    expectedRewrittenText: string;
    auxiliarySegments: Array<{ ordinal: number; text: string }>;
    auxiliaryLanguageCode: string;
    auxiliarySourceHash: string;
  }): Promise<CardEntryEntity | null> {
    const changed = await this.prisma.card.updateMany({
      where: {
        id: input.entryId,
        userId: input.userId,
        status: "completed",
        deletedAt: null,
        rewrittenText: input.expectedRewrittenText,
      },
      data: {
        auxiliarySegments: input.auxiliarySegments,
        auxiliaryLanguageCode: input.auxiliaryLanguageCode,
        auxiliarySourceHash: input.auxiliarySourceHash,
      },
    });
    if (changed.count !== 1) return null;
    const updated = await this.prisma.card.findFirst({ where: { id: input.entryId }, include: includeSegments });
    return updated ? toEntry(updated) : null;
  }

  async markImageDescriptionsPending(entryId: string, userId: string, imageIds: string[]): Promise<CardEntryEntity | null> {
    if (!imageIds.length) return this.findByIdForUser(entryId, userId);
    return this.prisma.$transaction(async (tx) => {
      // Serialize description claims for a Card across API instances/devices.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${entryId}, 0))`;
      const staleBefore = new Date(Date.now() - 15 * 60 * 1_000);
      const claimableStatus = {
        OR: [
          { descriptionStatus: { notIn: ["pending", "auxiliary_pending"] } },
          { descriptionStatus: { in: ["pending", "auxiliary_pending"] }, descriptionUpdatedAt: { lt: staleBefore } },
          { descriptionStatus: { in: ["pending", "auxiliary_pending"] }, descriptionUpdatedAt: null },
        ],
      };
      const activeOtherDescription = await tx.cardImageAsset.count({
        where: {
          entryId,
          userId,
          id: { notIn: imageIds },
          descriptionStatus: { in: ["pending", "auxiliary_pending"] },
          descriptionUpdatedAt: { gte: staleBefore },
        },
      });
      if (activeOtherDescription > 0) return null;
      const claimable = await tx.cardImageAsset.count({
        where: {
          id: { in: imageIds },
          entryId,
          userId,
          ...claimableStatus,
        },
      });
      if (claimable !== imageIds.length) return null;
      const changed = await tx.cardImageAsset.updateMany({
        where: { id: { in: imageIds }, entryId, userId, ...claimableStatus },
        data: { descriptionStatus: "pending", descriptionError: null, descriptionUpdatedAt: new Date() },
      });
      if (changed.count !== imageIds.length) return null;
      const updated = await tx.card.findFirst({ where: { id: entryId }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async saveImageDescriptionTexts(input: {
    entryId: string;
    userId: string;
    descriptions: Array<{
      imageId: string;
      text: string;
      languageCode: string;
      sourceHash: string;
      promptVersion: string;
      resultVersion: string;
    }>;
    contentSegments: CardContentSegmentWrite[];
  }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed", deletedAt: null },
        select: { id: true },
      });
      if (!entry) return null;
      for (const description of input.descriptions) {
        const changed = await tx.cardImageAsset.updateMany({
          where: { id: description.imageId, entryId: input.entryId, userId: input.userId, descriptionStatus: "pending" },
          data: {
            descriptionText: description.text,
            descriptionLanguageCode: description.languageCode,
            descriptionSourceHash: description.sourceHash,
            descriptionPromptVersion: description.promptVersion,
            descriptionResultVersion: description.resultVersion,
            descriptionStatus: "auxiliary_pending",
            descriptionError: null,
            descriptionUpdatedAt: new Date(),
          },
        });
        if (changed.count !== 1) return null;
      }
      const imageContentTypes = new Set(input.descriptions.map((description) => `image:${description.imageId}`));
      await syncContentSegments(
        tx,
        input.entryId,
        input.contentSegments.filter((write) => imageContentTypes.has(write.contentType)),
        false,
      );
      const updated = await tx.card.findFirst({ where: { id: input.entryId }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async saveImageDescriptions(input: {
    entryId: string;
    userId: string;
    descriptions: Array<{
      imageId: string;
      text: string;
      languageCode: string;
      sourceHash: string;
      promptVersion: string;
      resultVersion: string;
      auxiliarySegments: Array<{ ordinal: number; text: string }>;
      auxiliaryLanguageCode: string;
      auxiliaryPromptVersion: string;
    }>;
    contentSegments: CardContentSegmentWrite[];
  }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed", deletedAt: null },
        select: { id: true },
      });
      if (!entry) return null;
      for (const description of input.descriptions) {
        const changed = await tx.cardImageAsset.updateMany({
          where: {
            id: description.imageId,
            entryId: input.entryId,
            userId: input.userId,
            descriptionStatus: { in: ["pending", "auxiliary_pending"] },
          },
          data: {
            descriptionText: description.text,
            descriptionLanguageCode: description.languageCode,
            descriptionSourceHash: description.sourceHash,
            descriptionPromptVersion: description.promptVersion,
            descriptionResultVersion: description.resultVersion,
            descriptionAuxiliarySegments: description.auxiliarySegments,
            descriptionAuxiliaryLanguageCode: description.auxiliaryLanguageCode,
            descriptionAuxiliaryPromptVersion: description.auxiliaryPromptVersion,
            descriptionStatus: "completed",
            descriptionError: null,
            descriptionUpdatedAt: new Date(),
          },
        });
        if (changed.count !== 1) return null;
        await tx.cardEnrichmentJob.updateMany({
          where: {
            userId: input.userId,
            sourceKind: CARD_IMAGE_DESCRIPTION_SOURCE_KIND,
            sourceId: description.imageId,
            jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE,
            inputHash: description.sourceHash,
            inputVersion: cardImageDescriptionInputVersion({ sourceHash: description.sourceHash }),
            status: "queued",
          },
          data: { status: "completed", completedAt: new Date(), lastError: null },
        });
      }
      const imageContentTypes = new Set(input.descriptions.map((description) => `image:${description.imageId}`));
      await syncContentSegments(
        tx,
        input.entryId,
        input.contentSegments.filter((write) => imageContentTypes.has(write.contentType)),
        false,
      );
      const updated = await tx.card.findFirst({ where: { id: input.entryId }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async markImageDescriptionsFailed(entryId: string, userId: string, imageIds: string[], error: string): Promise<CardEntryEntity | null> {
    if (!imageIds.length) return this.findByIdForUser(entryId, userId);
    await this.prisma.cardImageAsset.updateMany({
      where: { id: { in: imageIds }, entryId, userId },
      data: { descriptionStatus: "failed", descriptionError: error.slice(0, 500), descriptionUpdatedAt: new Date() },
    });
    return this.findByIdForUser(entryId, userId);
  }

  async restoreImageDescriptionsAfterRefreshFailure(
    entryId: string,
    userId: string,
    imageIds: string[],
    error: string,
  ): Promise<CardEntryEntity | null> {
    if (!imageIds.length) return this.findByIdForUser(entryId, userId);
    await this.prisma.cardImageAsset.updateMany({
      where: {
        id: { in: imageIds },
        entryId,
        userId,
        descriptionText: { not: null },
      },
      data: {
        descriptionStatus: "completed",
        descriptionError: `REFRESH_FAILED:${error}`.slice(0, 500),
        descriptionUpdatedAt: new Date(),
      },
    });
    return this.findByIdForUser(entryId, userId);
  }

  async enqueueImageDescriptionJobs(entryId: string, userId: string, priority: number): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const images = await tx.cardImageAsset.findMany({
        where: { entryId, userId, descriptionStatus: { not: "completed" } },
        select: { id: true },
      });
      for (const image of images) {
        await enqueueImageDescriptionGeneration(tx, userId, entryId, image.id, priority);
      }
      return images.length;
    });
  }

  async markPhraseRecommendationSeen(entryId: string, userId: string): Promise<CardEntryEntity | null> {
    const changed = await this.prisma.card.updateMany({
      where: {
        id: entryId,
        userId,
        status: "completed",
        deletedAt: null,
        phraseRecommendationSeenAt: null,
      },
      data: { phraseRecommendationSeenAt: new Date() },
    });
    if (changed.count !== 1) return null;
    const updated = await this.prisma.card.findFirst({ where: { id: entryId }, include: includeSegments });
    return updated ? toEntry(updated) : null;
  }

  async listRecentPhraseRecommendationTexts(userId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        userId,
        phraseRecommendations: { not: Prisma.DbNull },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: Math.max(1, limit),
      select: { phraseRecommendations: true },
    });
    return rows.flatMap((row) => Array.isArray(row.phraseRecommendations)
      ? row.phraseRecommendations.flatMap((item: unknown) => item && typeof item === "object" && "text" in item && typeof item.text === "string" ? [item.text] : [])
      : []).slice(0, limit);
  }

  async appendPhraseRecommendation(input: {
    entryId: string;
    userId: string;
    contentType: CardLearningContentType;
    expectedSourceText: string;
    recommendation: {
      id: string;
      contentType: CardLearningContentType;
      contentVersion: string;
      segmentId: string;
      ordinal: number;
      startUtf16: number;
      endUtf16: number;
      text: string;
      meaning: string;
      distractors: string[];
      createdAt: string;
    } | null;
    promptVersion: string;
  }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.card.findFirst({
        where: {
          id: input.entryId,
          userId: input.userId,
          status: "completed",
          deletedAt: null,
        },
        include: includeSegments,
      });
      if (!current || contentTextForType(current, input.contentType) !== input.expectedSourceText) return null;
      const existing = Array.isArray(current.phraseRecommendations) ? current.phraseRecommendations : [];
      const changed = await tx.card.updateMany({
        where: {
          id: input.entryId,
          userId: input.userId,
          status: "completed",
          deletedAt: null,
        },
        data: {
          ...(input.recommendation
            ? { phraseRecommendations: [...existing, input.recommendation], phraseRecommendationExhaustedAt: null }
            : { phraseRecommendationExhaustedAt: new Date() }),
          phraseRecommendationPromptVersion: input.promptVersion,
        },
      });
      if (changed.count !== 1) return null;
      const updated = await tx.card.findFirst({ where: { id: input.entryId }, include: includeSegments });
      return updated ? toEntry(updated) : null;
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

  async aggregateCalendarByDate(userId: string, fromDateKey: string, toDateKey: string): Promise<Array<{
    dateKey: string;
    cardCount: number;
    originalChars: number;
    clozeBlankCount: number;
    clozeAttemptedBlankCount: number;
    clozeCorrectBlankCount: number;
  }>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      dateKey: string;
      cardCount: number | bigint;
      originalChars: number | bigint;
      clozeBlankCount: number | bigint;
      clozeAttemptedBlankCount: number | bigint;
      clozeCorrectBlankCount: number | bigint;
    }>>(
      `SELECT card."dateKey",
              COUNT(*)::int AS "cardCount",
              COALESCE(SUM(CASE WHEN card."originalText" IS NOT NULL THEN card."inputChars" ELSE 0 END), 0)::bigint AS "originalChars",
              COALESCE(SUM(practice."blankCount"), 0)::bigint AS "clozeBlankCount",
              COALESCE(SUM(practice."attemptedBlankCount"), 0)::bigint AS "clozeAttemptedBlankCount",
              COALESCE(SUM(practice."correctBlankCount"), 0)::bigint AS "clozeCorrectBlankCount"
         FROM "cards" AS card
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(row."blankCount"), 0)::bigint AS "blankCount",
                  COALESCE(SUM(CASE WHEN row."lastResult" IS NOT NULL THEN row."blankCount" ELSE 0 END), 0)::bigint AS "attemptedBlankCount",
                  COALESCE(SUM(CASE WHEN row."lastResult" = 'correct' THEN row."blankCount" ELSE 0 END), 0)::bigint AS "correctBlankCount"
             FROM (
               SELECT CASE WHEN jsonb_typeof(state."clozeState"->'blanks') = 'array'
                           THEN jsonb_array_length(state."clozeState"->'blanks') ELSE 0 END AS "blankCount",
                      state."clozeLastResult" AS "lastResult"
                 FROM "card_content_practice_states" AS state
                WHERE state."cardId" = card."id" AND state."userId" = card."userId"
               UNION ALL
               SELECT CASE WHEN jsonb_typeof(legacy."clozeState"->'blanks') = 'array'
                           THEN jsonb_array_length(legacy."clozeState"->'blanks') ELSE 0 END AS "blankCount",
                      legacy."clozeLastResult" AS "lastResult"
                 FROM "card_practice_states" AS legacy
                WHERE legacy."cardId" = card."id" AND legacy."userId" = card."userId"
                  AND NOT EXISTS (SELECT 1 FROM "card_content_practice_states" AS content WHERE content."cardId" = card."id" AND content."userId" = card."userId")
             ) AS row
         ) AS practice ON TRUE
        WHERE card."userId" = $1
          AND card."dateKey" >= $2
          AND card."dateKey" <= $3
          AND card."status" = 'completed'
          AND card."deletedAt" IS NULL
          AND card."isSample" = false
        GROUP BY card."dateKey"
        ORDER BY card."dateKey" ASC`,
      userId,
      fromDateKey,
      toDateKey,
    );
    return rows.map((row) => ({
      dateKey: row.dateKey,
      cardCount: Number(row.cardCount),
      originalChars: Number(row.originalChars),
      clozeBlankCount: Number(row.clozeBlankCount),
      clozeAttemptedBlankCount: Number(row.clozeAttemptedBlankCount),
      clozeCorrectBlankCount: Number(row.clozeCorrectBlankCount),
    }));
  }

  async findEarliestCompletedDateKey(userId: string): Promise<string | null> {
    const row = await this.prisma.card.findFirst({
      where: {
        userId,
        status: "completed",
        deletedAt: null,
        isSample: false,
      },
      orderBy: [{ dateKey: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { dateKey: true },
    });
    return row?.dateKey ?? null;
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

  async listMemoryRoundEntries(userId: string, limit: number, cardIds?: string[], allowOriginalPractice = true): Promise<CardEntryEntity[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    let orderedIds: string[];
    if (cardIds !== undefined) {
      orderedIds = [...new Set(cardIds)].slice(0, safeLimit);
    } else {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ cardId: string }>>(
        `SELECT candidate."cardId"
           FROM (
             SELECT legacy."cardId",
                    CASE
                      WHEN legacy."clozeNextReviewAt" IS NOT NULL AND legacy."clozeNextReviewAt" <= NOW() THEN 0
                      WHEN legacy."clozeLastResult" IN ('incorrect', 'revealed') THEN 1
                      WHEN legacy."clozeLastResult" IS NULL THEN 2
                      WHEN legacy."updatedAt" <= NOW() - INTERVAL '30 days' THEN 3
                      ELSE 4
                    END AS priority,
                    legacy."updatedAt"
               FROM "card_practice_states" legacy
               JOIN "cards" card ON card.id = legacy."cardId"
              WHERE legacy."userId" = $1
                AND card.status = 'completed'
                AND card."deletedAt" IS NULL
                AND card."isSample" = FALSE
                AND (card."rewrittenText" IS NOT NULL OR $3::boolean)
                AND jsonb_typeof(legacy."clozeState"->'blanks') = 'array'
                AND jsonb_array_length(legacy."clozeState"->'blanks') > 0
                AND NOT EXISTS (
                  SELECT 1 FROM "card_content_practice_states" content
                   WHERE content."cardId" = legacy."cardId" AND content."userId" = legacy."userId"
                )
             UNION ALL
             SELECT state."cardId",
                    CASE
                      WHEN state."clozeNextReviewAt" IS NOT NULL AND state."clozeNextReviewAt" <= NOW() THEN 0
                      WHEN state."clozeLastResult" IN ('incorrect', 'revealed') THEN 1
                      WHEN state."clozeLastResult" IS NULL THEN 2
                      WHEN state."updatedAt" <= NOW() - INTERVAL '30 days' THEN 3
                      ELSE 4
                    END AS priority,
                    state."updatedAt"
               FROM "card_content_practice_states" state
               JOIN "cards" card ON card.id = state."cardId"
              WHERE state."userId" = $1
                AND card.status = 'completed'
                AND card."deletedAt" IS NULL
                AND card."isSample" = FALSE
                AND (state."contentType" <> 'original' OR $3::boolean)
                AND jsonb_typeof(state."clozeState"->'blanks') = 'array'
                AND jsonb_array_length(state."clozeState"->'blanks') > 0
                AND EXISTS (
                  SELECT 1 FROM "card_content_segments" segment
                   WHERE segment."entryId" = state."cardId"
                     AND segment."contentType" = state."contentType"
                     AND segment."contentVersion" = state."contentVersion"
                )
           ) candidate
          GROUP BY candidate."cardId"
          ORDER BY MIN(candidate.priority) ASC, MIN(candidate."updatedAt") ASC, candidate."cardId" ASC
          LIMIT $2`,
        userId,
        safeLimit,
        allowOriginalPractice,
      );
      orderedIds = rows.map((row) => row.cardId);
    }
    if (!orderedIds.length) return [];
    const rows = await this.prisma.card.findMany({
      where: {
        id: { in: orderedIds },
        userId,
        status: "completed",
        deletedAt: null,
        isSample: false,
      },
      include: includeSegments,
    });
    const byId = new Map(rows.map((row) => [row.id, toEntry(row)]));
    return orderedIds.map((id) => byId.get(id)).filter((entry): entry is CardEntryEntity => Boolean(entry));
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
          rewrittenLanguageCode: input.rewrittenLanguageCode,
          rewrittenSourceHash: input.rewrittenSourceHash,
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
      await syncContentSegments(tx, input.entryId, input.contentSegments);
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
      await enqueuePhraseEnrichment(tx, {
        userId: completedEntry.userId,
        cardId: input.entryId,
        inputHash: input.embeddingInputHash,
      });
      if (!completedEntry.isSample) await hideCompletedSamples(tx, completedEntry.userId, input.publishedAt);
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
      await tx.cardContentSegment.deleteMany({ where: { entryId } });
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
    const result = await this.prisma.card.updateMany({ where: { id: entryId, userId, status: "completed" }, data: { status: "deleted", deletedAt } });
    return result.count === 1;
  }

  async restoreDeleted(entryId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.card.updateMany({ where: { id: entryId, userId, status: "deleted" }, data: { status: "completed", deletedAt: null } });
    return result.count === 1;
  }

  async permanentlyDelete(entryId: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.card.findFirst({ where: { id: entryId, userId, status: "deleted" }, select: { id: true } });
      if (!card) return false;
      await tx.cardImageAsset.updateMany({ where: { entryId }, data: { status: "cleanup_pending" } });
      await tx.card.delete({ where: { id: entryId } });
      return true;
    });
  }

  async listDeletedByUser(userId: string): Promise<CardEntryEntity[]> {
    const rows = await this.prisma.card.findMany({ where: { userId, status: "deleted" }, orderBy: { deletedAt: "desc" }, include: includeSegments });
    return rows.map(toEntry);
  }

  async deleteExpiredTrash(before: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const cards = await tx.card.findMany({ where: { status: "deleted", deletedAt: { lt: before } }, select: { id: true }, take: 500 });
      if (!cards.length) return 0;
      const ids = cards.map((card: { id: string }) => card.id);
      await tx.cardImageAsset.updateMany({ where: { entryId: { in: ids } }, data: { status: "cleanup_pending" } });
      return (await tx.card.deleteMany({ where: { id: { in: ids }, status: "deleted" } })).count;
    });
  }

  async findPracticeState(userId: string, cardId: string): Promise<CardPracticeStateEntity | null> {
    const row = await this.prisma.cardPracticeState.findUnique({
      where: { cardId },
    });
    return row?.userId === userId ? toPracticeState(row) : null;
  }

  async listPracticeStates(userId: string, cardIds: string[]): Promise<CardPracticeStateEntity[]> {
    if (!cardIds.length) return [];
    const rows = await this.prisma.cardPracticeState.findMany({
      where: { userId, cardId: { in: cardIds } },
    });
    return rows.map(toPracticeState);
  }

  async findContentPracticeState(
    userId: string,
    cardId: string,
    contentType: CardLearningContentType,
  ): Promise<CardContentPracticeStateEntity | null> {
    const row = await this.prisma.cardContentPracticeState.findUnique({
      where: { cardId_contentType: { cardId, contentType } },
    });
    return row?.userId === userId ? toContentPracticeState(row) : null;
  }

  async listContentPracticeStates(userId: string, cardIds: string[]): Promise<CardContentPracticeStateEntity[]> {
    if (!cardIds.length) return [];
    const rows = await this.prisma.cardContentPracticeState.findMany({
      where: { userId, cardId: { in: cardIds } },
    });
    return rows.map(toContentPracticeState);
  }

  async saveContentDictationResult(input: {
    userId: string;
    cardId: string;
    contentType: CardLearningContentType;
    contentVersion: string;
    result: "correct" | "incorrect" | "revealed";
    practicedAt: Date;
    nextReviewAt: Date;
    correctStreak: number;
  }): Promise<CardContentPracticeStateEntity> {
    const row = await this.prisma.cardContentPracticeState.upsert({
      where: { cardId_contentType: { cardId: input.cardId, contentType: input.contentType } },
      create: {
        userId: input.userId,
        cardId: input.cardId,
        contentType: input.contentType,
        contentVersion: input.contentVersion,
        dictationLastResult: input.result,
        dictationCorrectStreak: input.correctStreak,
        dictationNextReviewAt: input.nextReviewAt,
      },
      update: {
        contentVersion: input.contentVersion,
        dictationLastResult: input.result,
        dictationCorrectStreak: input.correctStreak,
        dictationNextReviewAt: input.nextReviewAt,
      },
    });
    return toContentPracticeState(row);
  }

  async saveContentClozeState(input: {
    userId: string;
    cardId: string;
    contentType: CardLearningContentType;
    contentVersion: string;
    expectedVersion: number;
    state: unknown;
    result: "correct" | "incorrect" | "revealed" | null;
    practicedAt: Date | null;
    nextReviewAt: Date | null;
    correctStreak: number;
    phraseMutation?: Parameters<CardRepository["saveClozeState"]>[0]["phraseMutation"];
  }): Promise<CardContentPracticeStateEntity | null> {
    const key = {
      cardId: input.cardId,
      userId: input.userId,
      contentType: input.contentType,
      contentVersion: input.contentVersion,
    };
    const practiceData = input.result ? {
      clozeLastResult: input.result,
      clozeCorrectStreak: input.correctStreak,
      clozeNextReviewAt: input.nextReviewAt,
    } : {};
    try {
      return await this.prisma.$transaction(async (tx) => {
        let row: any;
        if (input.expectedVersion === 0) {
          const changed = await tx.cardContentPracticeState.updateMany({
            where: { ...key, clozeVersion: 0 },
            data: { clozeState: input.state, clozeVersion: { increment: 1 }, ...practiceData },
          });
          if (changed.count === 1) {
            row = await tx.cardContentPracticeState.findUnique({
              where: { cardId_contentType: { cardId: input.cardId, contentType: input.contentType } },
            });
          } else {
            row = await tx.cardContentPracticeState.create({
              data: { ...key, clozeState: input.state, clozeVersion: 1, ...practiceData },
            });
          }
        } else {
          const changed = await tx.cardContentPracticeState.updateMany({
            where: { ...key, clozeVersion: input.expectedVersion },
            data: { clozeState: input.state, clozeVersion: { increment: 1 }, ...practiceData },
          });
          if (changed.count !== 1) return null;
          row = await tx.cardContentPracticeState.findUnique({
            where: { cardId_contentType: { cardId: input.cardId, contentType: input.contentType } },
          });
        }
        if (!row) return null;
        await applyPhraseMutation(tx, input);
        return toContentPracticeState(row);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
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
          { status: "cleanup_pending", sourceKind: { in: ["review_segment", "review_article", "dictation_sentence"] } },
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

  async createImageUpload(input: {
    id: string;
    userId: string;
    objectKey: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    expiresAt: Date;
  }): Promise<CardImageAssetEntity> {
    const row = await this.prisma.cardImageAsset.create({
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
      if (entry.images?.[0]?.id === input.imageUploadId && entry.images.length === 1) return toEntry(entry);
      await tx.cardImageAsset.updateMany({
        where: { entryId: entry.id },
        data: { entryId: null, status: "cleanup_pending" },
      });
      const replacedImageContentTypes = entry.images.map((image: { id: string }) => `image:${image.id}`);
      if (replacedImageContentTypes.length) {
        await tx.cardContentSegment.deleteMany({ where: { entryId: entry.id, contentType: { in: replacedImageContentTypes } } });
        await tx.cardContentPracticeState.deleteMany({ where: { cardId: entry.id, contentType: { in: replacedImageContentTypes } } });
        await tx.card.update({
          where: { id: entry.id },
          data: {
            phraseRecommendations: Prisma.DbNull,
            phraseRecommendationSeenAt: null,
            phraseRecommendationExhaustedAt: null,
            phraseRecommendationPromptVersion: null,
          },
        });
      }
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
        await enqueueImageDescriptionGeneration(tx, input.userId, entry.id, input.imageUploadId, 100);
      }
      const updated = await tx.card.findFirst({
        where: { id: entry.id },
        include: includeSegments,
      });
      return updated ? toEntry(updated) : null;
    });
  }

  async appendEntryImage(input: { entryId: string; userId: string; imageUploadId: string }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed" },
        include: includeSegments,
      });
      if (!entry) return null;
      if (entry.images.some((image: { id: string }) => image.id === input.imageUploadId)) return toEntry(entry);
      const ordinal = entry.images.reduce((max: number, image: { ordinal: number }) => Math.max(max, image.ordinal), -1) + 1;
      const claimed = await tx.cardImageAsset.updateMany({
        where: {
          id: input.imageUploadId,
          userId: input.userId,
          entryId: null,
          status: { in: ["approved", "approved_with_review"] },
          thumbnailStatus: "ready",
          expiresAt: { gt: new Date() },
        },
        data: { entryId: entry.id, ordinal, claimedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("CARD_IMAGE_NOT_READY");
      await enqueueImageDescriptionGeneration(tx, input.userId, entry.id, input.imageUploadId, 100);
      const updated = await tx.card.findFirst({ where: { id: entry.id }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async removeEntryImage(input: { entryId: string; userId: string; imageId: string }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed" },
        include: includeSegments,
      });
      if (!entry) return null;
      await tx.cardImageAsset.updateMany({
        where: { id: input.imageId, entryId: entry.id, userId: input.userId },
        data: { entryId: null, ordinal: 0, status: "cleanup_pending" },
      });
      const removedContentType = `image:${input.imageId}`;
      await tx.cardContentSegment.deleteMany({ where: { entryId: entry.id, contentType: removedContentType } });
      await tx.cardContentPracticeState.deleteMany({ where: { cardId: entry.id, contentType: removedContentType } });
      if (entry.images.some((image: { id: string }) => image.id === input.imageId)) {
        await tx.card.update({
          where: { id: entry.id },
          data: {
            phraseRecommendations: Prisma.DbNull,
            phraseRecommendationSeenAt: null,
            phraseRecommendationExhaustedAt: null,
            phraseRecommendationPromptVersion: null,
          },
        });
      }
      const updated = await tx.card.findFirst({ where: { id: entry.id }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async updateEntryCoverFocus(input: { entryId: string; userId: string; imageId: string; focusX: number; focusY: number }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed" },
        include: includeSegments,
      });
      if (!entry || entry.images[0]?.id !== input.imageId) return null;
      await tx.cardImageAsset.update({
        where: { id: input.imageId },
        data: { focusX: input.focusX, focusY: input.focusY },
      });
      const updated = await tx.card.findFirst({ where: { id: entry.id }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }

  async refreshContentSegments(input: {
    entryId: string;
    userId: string;
    contentSegments: CardContentSegmentWrite[];
  }): Promise<CardEntryEntity | null> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.card.findFirst({
        where: { id: input.entryId, userId: input.userId, status: "completed" },
        select: { id: true },
      });
      if (!entry) return null;
      await syncContentSegments(tx, entry.id, input.contentSegments);
      const updated = await tx.card.findFirst({ where: { id: entry.id }, include: includeSegments });
      return updated ? toEntry(updated) : null;
    });
  }
}

async function syncContentSegments(
  tx: any,
  entryId: string,
  writes: CardContentSegmentWrite[],
  removeUnlisted = true,
): Promise<void> {
  if (removeUnlisted) {
    const wantedTypes = writes.map((write) => write.contentType);
    const obsolete = await tx.cardContentSegment.findMany({
      where: { entryId, ...(wantedTypes.length ? { contentType: { notIn: wantedTypes } } : {}) },
      select: { contentType: true },
      distinct: ["contentType"],
    });
    if (obsolete.length) {
      const obsoleteTypes = obsolete.map((row: { contentType: string }) => row.contentType);
      await tx.cardContentSegment.deleteMany({ where: { entryId, contentType: { in: obsoleteTypes } } });
      await tx.cardContentPracticeState.deleteMany({ where: { cardId: entryId, contentType: { in: obsoleteTypes } } });
    }
  }
  for (const write of writes) {
    const existing = await tx.cardContentSegment.findFirst({
      where: { entryId, contentType: write.contentType },
      select: { contentVersion: true },
    });
    if (existing?.contentVersion === write.contentVersion) continue;
    if (existing) {
      const existingSegments = await tx.cardContentSegment.findMany({
        where: { entryId, contentType: write.contentType },
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, text: true, startUtf16: true, endUtf16: true },
      });
      const sameContent = existingSegments.length === write.segments.length && existingSegments.every((segment: any, index: number) => {
        const next = write.segments[index];
        return next && segment.ordinal === next.ordinal && segment.text === next.text &&
          segment.startUtf16 === next.startUtf16 && segment.endUtf16 === next.endUtf16;
      });
      // Migrated rows intentionally retain their legacy version so existing
      // practice JSON keeps referring to the same segment ids.
      if (sameContent) continue;
    }
    await tx.cardContentSegment.deleteMany({ where: { entryId, contentType: write.contentType } });
    if (write.segments.length) {
      await tx.cardContentSegment.createMany({
        data: write.segments.map((segment) => ({
          entryId,
          contentType: write.contentType,
          contentVersion: write.contentVersion,
          ...segment,
        })),
      });
    }
    await tx.cardContentPracticeState.deleteMany({
      where: { cardId: entryId, contentType: write.contentType, contentVersion: { not: write.contentVersion } },
    });
  }
}

async function enqueueTopicGeneration(
  tx: any,
  input: { userId: string; cardId: string; inputHash: string },
): Promise<void> {
  const inputVersion = `${CARD_TOPIC_PROMPT_VERSION}:${input.inputHash}`;
  await tx.cardEnrichmentJob.upsert({
    where: {
      userId_sourceKind_sourceId_jobType_inputVersion: {
        userId: input.userId,
        sourceKind: "card",
        sourceId: input.cardId,
        jobType: "generate_topic",
        inputVersion,
      },
    },
    create: {
      userId: input.userId,
      sourceKind: "card",
      sourceId: input.cardId,
      jobType: "generate_topic",
      inputHash: input.inputHash,
      inputVersion,
      payload: { schemaVersion: 1, platformFunded: true },
    },
    update: {
      status: "queued",
      availableAt: new Date(),
      inputHash: input.inputHash,
      payload: { schemaVersion: 1, platformFunded: true },
      attempts: 0,
      processingAt: null,
      leaseExpiresAt: null,
      workerId: null,
      lastError: null,
      completedAt: null,
      failedAt: null,
    },
  });
}

async function enqueueImageDescriptionGeneration(
  tx: any,
  userId: string,
  cardId: string,
  imageId: string,
  priority: number,
): Promise<void> {
  const image = await tx.cardImageAsset.findFirst({
    where: { id: imageId, userId, entryId: cardId, fileMd5: { not: null } },
    select: { fileMd5: true },
  });
  if (!image?.fileMd5) return;
  const inputVersion = cardImageDescriptionInputVersion({ sourceHash: image.fileMd5 });
  await tx.cardEnrichmentJob.upsert({
    where: { userId_sourceKind_sourceId_jobType_inputVersion: {
      userId, sourceKind: CARD_IMAGE_DESCRIPTION_SOURCE_KIND, sourceId: imageId,
      jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE, inputVersion,
    } },
    create: {
      userId, sourceKind: CARD_IMAGE_DESCRIPTION_SOURCE_KIND, sourceId: imageId,
      jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE, inputHash: image.fileMd5, inputVersion,
      priority,
      payload: {
        schemaVersion: CARD_IMAGE_DESCRIPTION_PAYLOAD_SCHEMA_VERSION,
        cardId,
        promptVersion: CARD_IMAGE_DESCRIPTION_PROMPT_VERSION,
        resultVersion: CARD_IMAGE_DESCRIPTION_RESULT_VERSION,
      },
    },
    update: { priority, availableAt: new Date() },
  });
}

async function enqueueEmbeddingGeneration(
  tx: any,
  input: { userId: string; cardId: string; inputHash: string; inputVersion: string },
): Promise<void> {
  await tx.cardEnrichmentJob.upsert({
    where: {
      userId_sourceKind_sourceId_jobType_inputVersion: {
        userId: input.userId,
        sourceKind: "card",
        sourceId: input.cardId,
        jobType: "generate_embedding",
        inputVersion: input.inputVersion,
      },
    },
    create: {
      userId: input.userId,
      sourceKind: "card",
      sourceId: input.cardId,
      jobType: "generate_embedding",
      inputHash: input.inputHash,
      inputVersion: input.inputVersion,
      payload: { schemaVersion: 1 },
    },
    update: {
      status: "queued",
      availableAt: new Date(),
      inputHash: input.inputHash,
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
}

async function enqueuePhraseEnrichment(
  tx: any,
  input: { userId: string; cardId: string; inputHash: string },
): Promise<void> {
  for (const job of [
    { jobType: "index_card_phrases", inputVersion: `card_phrase_index_v1:${input.inputHash}` },
    { jobType: "detect_progress_phrases", inputVersion: `progress_phrase_detection_v1:${input.inputHash}` },
  ] as const) {
    await tx.cardEnrichmentJob.upsert({
      where: {
        userId_sourceKind_sourceId_jobType_inputVersion: {
          userId: input.userId,
          sourceKind: "card",
          sourceId: input.cardId,
          jobType: job.jobType,
          inputVersion: job.inputVersion,
        },
      },
      create: {
        userId: input.userId,
        sourceKind: "card",
        sourceId: input.cardId,
        jobType: job.jobType,
        inputHash: input.inputHash,
        inputVersion: job.inputVersion,
        payload: { schemaVersion: 1 },
      },
      update: {
        status: "queued",
        availableAt: new Date(),
        inputHash: input.inputHash,
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
    title: row.title ?? null,
    originalText: row.originalText ?? null,
    originalContentHash: row.originalContentHash ?? null,
    rewrittenText: row.rewrittenText ?? null,
    rewrittenLanguageCode: row.rewrittenLanguageCode ?? null,
    rewrittenSourceHash: row.rewrittenSourceHash ?? null,
    translationText: row.translationText ?? null,
    translationLanguageCode: row.translationLanguageCode ?? null,
    translationSourceHash: row.translationSourceHash ?? null,
    auxiliarySegments: row.auxiliarySegments ?? null,
    auxiliaryLanguageCode: row.auxiliaryLanguageCode ?? null,
    auxiliarySourceHash: row.auxiliarySourceHash ?? null,
    phraseRecommendations: row.phraseRecommendations ?? null,
    phraseRecommendationSeenAt: row.phraseRecommendationSeenAt ?? null,
    phraseRecommendationExhaustedAt: row.phraseRecommendationExhaustedAt ?? null,
    phraseRecommendationPromptVersion: row.phraseRecommendationPromptVersion ?? null,
    replyText: row.replyText ?? null,
    replyLanguageCode: row.replyLanguageCode ?? null,
    replySourceHash: row.replySourceHash ?? null,
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
    contentSegments: Array.isArray(row.contentSegments) ? row.contentSegments.map(toContentSegment) : [],
    images: Array.isArray(row.images) ? row.images.map(toImageAsset) : [],
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

function toContentSegment(row: any): CardContentSegmentEntity {
  return {
    ...toSegment(row),
    contentType: row.contentType,
    contentVersion: row.contentVersion,
    updatedAt: row.updatedAt,
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

function sampleContentHash(text: string): string {
  return `sample:v1:${Buffer.from(text.normalize("NFKC")).toString("base64url").slice(0, 64)}`;
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
    updatedAt: row.updatedAt,
  };
}

function toContentPracticeState(row: any): CardContentPracticeStateEntity {
  return {
    ...toPracticeState(row),
    contentType: row.contentType,
    contentVersion: row.contentVersion,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function hideCompletedSamples(tx: any, userId: string, hiddenAt: Date): Promise<void> {
  const visibleSamples = await tx.card.findMany({
    where: { userId, isSample: true, status: "completed", deletedAt: null },
    select: { id: true },
  });
  const sampleIds = visibleSamples.map((sample: { id: string }) => sample.id);
  if (!sampleIds.length) return;
  await tx.card.updateMany({
    where: { id: { in: sampleIds } },
    data: {
      status: "deleted",
      originalText: null,
      rewrittenText: null,
      deletedAt: hiddenAt,
    },
  });
  await tx.cardRewriteSegment.deleteMany({ where: { entryId: { in: sampleIds } } });
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
    ordinal: Number(row.ordinal) || 0,
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
    focusX: Number.isFinite(row.focusX) ? row.focusX : 0.5,
    focusY: Number.isFinite(row.focusY) ? row.focusY : 0.5,
    fileMd5: row.fileMd5 ?? null,
    moderationRequestId: row.moderationRequestId ?? null,
    moderationSuggestion: row.moderationSuggestion ?? null,
    moderationLabel: row.moderationLabel ?? null,
    descriptionText: row.descriptionText ?? null,
    descriptionLanguageCode: row.descriptionLanguageCode ?? null,
    descriptionSourceHash: row.descriptionSourceHash ?? null,
    descriptionPromptVersion: row.descriptionPromptVersion ?? null,
    descriptionResultVersion: row.descriptionResultVersion ?? null,
    descriptionAuxiliarySegments: row.descriptionAuxiliarySegments ?? null,
    descriptionAuxiliaryLanguageCode: row.descriptionAuxiliaryLanguageCode ?? null,
    descriptionAuxiliaryPromptVersion: row.descriptionAuxiliaryPromptVersion ?? null,
    descriptionStatus: row.descriptionStatus === "pending" || row.descriptionStatus === "auxiliary_pending" || row.descriptionStatus === "completed" || row.descriptionStatus === "failed"
      ? row.descriptionStatus
      : "not_requested",
    descriptionError: row.descriptionError ?? null,
    descriptionUpdatedAt: row.descriptionUpdatedAt ?? null,
    expiresAt: row.expiresAt,
    claimedAt: row.claimedAt ?? null,
  };
}

function contentTextForType(entry: any, contentType: CardLearningContentType): string | null {
  if (contentType === "original") return entry.originalText ?? null;
  if (contentType === "rewrite") return entry.rewrittenText ?? null;
  if (contentType === "reply") return entry.replyText ?? null;
  if (contentType.startsWith("image:")) {
    return entry.images?.find((image: { id: string }) => `image:${image.id}` === contentType)?.descriptionText ?? null;
  }
  return null;
}
