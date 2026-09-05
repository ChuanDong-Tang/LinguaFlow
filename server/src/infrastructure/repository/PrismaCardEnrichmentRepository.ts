import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { buildCardEmbeddingInput } from "@lf/core/text/cardEmbedding.js";
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
import {
  CARD_IMAGE_DESCRIPTION_JOB_TYPE,
  CARD_IMAGE_DESCRIPTION_SOURCE_KIND,
  CARD_IMAGE_DESCRIPTION_PAYLOAD_SCHEMA_VERSION,
  cardImageDescriptionInputVersion,
} from "@lf/core/Prompts/cardImageDescriptionPrompt.js";

export class PrismaCardEnrichmentRepository implements CardEnrichmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async enqueueMissingImageDescriptionJobs(input: {
    limit: number;
    maxOutstanding: number;
    createdBefore: Date;
    promptVersion: string;
    resultVersion: string;
    refreshOutdated: boolean;
  }): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('card_image_description_backfill_scan')) AS "acquired"
      `;
      if (!lock[0]?.acquired) return 0;
      const outstanding = await tx.cardEnrichmentJob.count({
        where: { jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE, status: { in: ["queued", "processing"] } },
      });
      const availableSlots = Math.max(0, Math.max(1, input.maxOutstanding) - outstanding);
      if (availableSlots === 0) return 0;
      const scanLimit = Math.min(Math.max(1, input.limit), availableSlots);
      const inputVersionPrefix = `${input.promptVersion}:${input.resultVersion}:`;
      const images = await tx.$queryRaw<Array<{ id: string; userId: string; entryId: string; fileMd5: string }>>`
        SELECT i."id", i."userId", i."entryId", i."fileMd5"
          FROM "card_image_assets" i
          JOIN "cards" c ON c."id" = i."entryId"
         WHERE i."status" IN ('approved', 'approved_with_review')
           AND (
             i."descriptionStatus" <> 'completed'
             OR (${input.refreshOutdated}
               AND (
                 i."descriptionPromptVersion" IS DISTINCT FROM ${input.promptVersion}
                 OR i."descriptionResultVersion" IS DISTINCT FROM ${input.resultVersion}
                 OR i."descriptionSourceHash" IS DISTINCT FROM i."fileMd5"
               )
             )
           )
           AND i."fileMd5" IS NOT NULL
           AND i."createdAt" <= ${input.createdBefore}
           AND c."status" = 'completed'
           AND c."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM "card_enrichment_jobs" j
              WHERE j."userId" = i."userId"
                AND j."sourceKind" = ${CARD_IMAGE_DESCRIPTION_SOURCE_KIND}
                AND j."sourceId" = i."id"
                AND j."jobType" = ${CARD_IMAGE_DESCRIPTION_JOB_TYPE}
                AND j."inputVersion" = ${inputVersionPrefix} || i."fileMd5"
           )
         ORDER BY i."createdAt" ASC, i."id" ASC
         LIMIT ${scanLimit}
      `;
      let enqueued = 0;
      for (const image of images) {
        const inputVersion = cardImageDescriptionInputVersion({
          promptVersion: input.promptVersion,
          resultVersion: input.resultVersion,
          sourceHash: image.fileMd5,
        });
        const key = {
            userId: image.userId, sourceKind: CARD_IMAGE_DESCRIPTION_SOURCE_KIND, sourceId: image.id,
            jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE, inputVersion,
        };
        if (await tx.cardEnrichmentJob.findUnique({
          where: { userId_sourceKind_sourceId_jobType_inputVersion: key },
          select: { id: true },
        })) continue;
        await tx.cardEnrichmentJob.create({
          data: {
            userId: image.userId, sourceKind: CARD_IMAGE_DESCRIPTION_SOURCE_KIND, sourceId: image.id,
            jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE, inputHash: image.fileMd5!, inputVersion,
            priority: 0,
            payload: {
              schemaVersion: CARD_IMAGE_DESCRIPTION_PAYLOAD_SCHEMA_VERSION,
              cardId: image.entryId,
              promptVersion: input.promptVersion,
              resultVersion: input.resultVersion,
            },
          },
        });
        enqueued += 1;
      }
      return enqueued;
    });
  }

  async cancelObsoleteImageDescriptionJobs(currentInputVersionPrefix: string, reason: string): Promise<number> {
    const result = await this.prisma.cardEnrichmentJob.updateMany({
      where: {
        jobType: CARD_IMAGE_DESCRIPTION_JOB_TYPE,
        status: "queued",
        NOT: { inputVersion: { startsWith: currentInputVersionPrefix } },
      },
      data: {
        status: "cancelled",
        lastError: reason.slice(0, 500),
        completedAt: new Date(),
        failedAt: null,
        leaseExpiresAt: null,
        workerId: null,
      },
    });
    return result.count;
  }

  async claimNextImageDescriptionJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob(CARD_IMAGE_DESCRIPTION_JOB_TYPE, workerId, leaseExpiresAt);
  }

  async loadImageDescriptionSource(job: CardEnrichmentJobEntity): Promise<{
    cardId: string;
    imageId: string;
    forceRegenerate: boolean;
  } | null> {
    if (job.sourceKind !== CARD_IMAGE_DESCRIPTION_SOURCE_KIND) return null;
    const payload = imageDescriptionPayload(job.payload);
    if (!payload) return null;
    const image = await this.prisma.cardImageAsset.findFirst({
      where: {
        id: job.sourceId, userId: job.userId, entryId: { not: null }, fileMd5: job.inputHash,
        entry: { status: "completed", deletedAt: null },
      },
      select: {
        id: true,
        entryId: true,
        descriptionStatus: true,
        descriptionSourceHash: true,
        descriptionPromptVersion: true,
        descriptionResultVersion: true,
      },
    });
    if (!image?.entryId) return null;
    const current = image.descriptionStatus === "completed"
      && image.descriptionSourceHash === job.inputHash
      && image.descriptionPromptVersion === payload.promptVersion
      && image.descriptionResultVersion === payload.resultVersion;
    return current ? null : {
      cardId: image.entryId,
      imageId: image.id,
      forceRegenerate: image.descriptionStatus === "completed"
        || (Boolean(image.descriptionSourceHash)
        && (image.descriptionSourceHash !== job.inputHash
          || image.descriptionPromptVersion !== payload.promptVersion
          || image.descriptionResultVersion !== payload.resultVersion)),
    };
  }

  async enqueueMissingAuxiliaryJobs(limit: number, createdBefore: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('card_auxiliary_backfill_scan')) AS "acquired"
      `;
      if (!lock[0]?.acquired) return 0;
      const boundedLimit = Math.max(1, limit);
      const outstanding = await tx.cardEnrichmentJob.count({
        where: { jobType: "generate_auxiliary", status: { in: ["queued", "processing"] } },
      });
      const availableSlots = Math.max(0, boundedLimit - outstanding);
      if (availableSlots === 0) return 0;
      const cards = await tx.$queryRaw<Array<{
        id: string;
        userId: string;
        rewrittenText: string;
        appLocaleSnapshot: string;
      }>>`
        SELECT c."id", c."userId", c."rewrittenText", c."appLocaleSnapshot"
          FROM "cards" c
         WHERE c."status" = 'completed'
           AND c."deletedAt" IS NULL
           AND c."rewrittenText" IS NOT NULL
           AND c."auxiliarySegments" IS NULL
           AND c."createdAt" <= ${createdBefore}
           AND EXISTS (SELECT 1 FROM "card_rewrite_segments" s WHERE s."entryId" = c."id")
           AND NOT EXISTS (
             SELECT 1 FROM "card_enrichment_jobs" j
              WHERE j."userId" = c."userId"
                AND j."sourceKind" = 'card'
                AND j."sourceId" = c."id"
                AND j."jobType" = 'generate_auxiliary'
                AND j."status" IN ('queued', 'processing', 'failed')
           )
         ORDER BY c."createdAt" ASC, c."id" ASC
         LIMIT ${availableSlots}
      `;
      for (const card of cards) {
        const inputHash = cardContentHash(card.rewrittenText);
        await tx.cardEnrichmentJob.upsert({
          where: {
            userId_sourceKind_sourceId_jobType_inputVersion: {
              userId: card.userId,
              sourceKind: "card",
              sourceId: card.id,
              jobType: "generate_auxiliary",
              inputVersion: "card_auxiliary_v1",
            },
          },
          create: {
            userId: card.userId,
            sourceKind: "card",
            sourceId: card.id,
            jobType: "generate_auxiliary",
            inputHash,
            inputVersion: "card_auxiliary_v1",
            payload: { schemaVersion: 1, appLocale: card.appLocaleSnapshot },
          },
          update: {
            status: "queued",
            availableAt: new Date(),
            inputHash,
            payload: { schemaVersion: 1, appLocale: card.appLocaleSnapshot },
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
      return cards.length;
    });
  }

  async claimNextAuxiliaryJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("generate_auxiliary", workerId, leaseExpiresAt);
  }

  async loadAuxiliarySource(job: CardEnrichmentJobEntity) {
    if (job.sourceKind !== "card") return null;
    const card = await this.prisma.card.findFirst({
      where: {
        id: job.sourceId,
        userId: job.userId,
        status: "completed",
        deletedAt: null,
        auxiliarySegments: { equals: Prisma.DbNull },
      },
      select: {
        rewrittenText: true,
        languageCode: true,
        appLocaleSnapshot: true,
        promptDifficultySnapshot: true,
        segments: { orderBy: { ordinal: "asc" }, select: { ordinal: true, text: true } },
      },
    });
    if (!card?.rewrittenText || !card.segments.length || cardContentHash(card.rewrittenText) !== job.inputHash) return null;
    return {
      userId: job.userId,
      sourceId: job.sourceId,
      rewrittenText: card.rewrittenText,
      languageCode: card.languageCode,
      appLocale: card.appLocaleSnapshot,
      difficulty: card.promptDifficultySnapshot,
      segments: card.segments,
    };
  }

  async completeAuxiliaryJob(
    job: CardEnrichmentJobEntity,
    auxiliarySegments: Array<{ ordinal: number; text: string }>,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.card.findFirst({
          where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
          select: { rewrittenText: true },
        });
        if (!current?.rewrittenText || cardContentHash(current.rewrittenText) !== job.inputHash) {
          throw new Error("CARD_AUXILIARY_SOURCE_STALE");
        }
        const card = await tx.card.updateMany({
          where: {
            id: job.sourceId,
            userId: job.userId,
            status: "completed",
            deletedAt: null,
            rewrittenText: { not: null },
            auxiliarySegments: { equals: Prisma.DbNull },
          },
          data: {
            auxiliarySegments,
            auxiliaryLanguageCode: auxiliaryLocaleFromPayload(job.payload),
            auxiliarySourceHash: job.inputHash,
          },
        });
        if (card.count !== 1) throw new Error("CARD_AUXILIARY_SOURCE_STALE");
        const claimed = await tx.cardEnrichmentJob.updateMany({
          where: { id: job.id, status: "processing", workerId: job.workerId, inputHash: job.inputHash },
          data: { status: "completed", completedAt: new Date(), leaseExpiresAt: null, workerId: null, lastError: null },
        });
        if (claimed.count !== 1) throw new Error("CARD_AUXILIARY_JOB_LEASE_LOST");
      });
      return true;
    } catch (error) {
      if (error instanceof Error && (error.message === "CARD_AUXILIARY_SOURCE_STALE" || error.message === "CARD_AUXILIARY_JOB_LEASE_LOST")) return false;
      throw error;
    }
  }

  async claimNextTopicJob(workerId: string, leaseExpiresAt: Date): Promise<CardEnrichmentJobEntity | null> {
    return this.claimNextJob("generate_topic", workerId, leaseExpiresAt);
  }

  async loadTopicSource(job: CardEnrichmentJobEntity) {
    if (job.sourceKind !== "card") return null;
    const card = await this.prisma.card.findFirst({
      where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
      select: { originalText: true, originalContentHash: true, appLocaleSnapshot: true, clientId: true, promptVersion: true },
    });
    if (!card?.originalText || card.originalContentHash !== job.inputHash) return null;
    return {
      userId: job.userId,
      sourceId: job.sourceId,
      originalText: card.originalText,
      appLocale: card.appLocaleSnapshot,
      ...(isChatHistoryMigrationCard(card.clientId, card.promptVersion) ? { billingExemptReason: "chat_history_migration" as const } : {}),
    };
  }

  async completeTopicJob(job: CardEnrichmentJobEntity, topic: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cardEnrichmentJob.updateMany({
        where: { id: job.id, status: "processing", workerId: job.workerId },
        data: { status: "completed", completedAt: new Date(), leaseExpiresAt: null, workerId: null, lastError: null },
      });
      if (claimed.count !== 1) return false;
      const updated = await tx.card.updateMany({
        where: {
          id: job.sourceId,
          userId: job.userId,
          status: "completed",
          deletedAt: null,
          originalContentHash: job.inputHash,
        },
        data: { topic, topicEditedAt: null },
      });
      if (updated.count !== 1) return false;
      const card = await tx.card.findFirst({
        where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
        select: { originalText: true, rewrittenText: true },
      });
      if (card?.originalText && card.rewrittenText) {
        const embeddingInput = buildCardEmbeddingInput(card.originalText, card.rewrittenText);
        const inputHash = createHash("sha256").update(embeddingInput).digest("hex");
        await enqueueEmbeddingGeneration(tx, {
          userId: job.userId,
          cardId: job.sourceId,
          inputHash,
          inputVersion: `card_embedding_input_v1:${inputHash}`,
        });
      }
      return true;
    });
  }

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
          ORDER BY "priority" DESC, "availableAt" ASC, "createdAt" ASC
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
    billingExemptReason?: "chat_history_migration";
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
    if (!phrase) return null;
    const migrationCard = job.sourceKind === "card"
      ? await this.prisma.card.findFirst({
          where: { id: job.sourceId, userId: job.userId },
          select: { clientId: true, promptVersion: true },
        })
      : null;
    return {
      phraseId: phrase.id,
      userId: phrase.userId,
      languageCode: phrase.languageCode,
      surfaceText: phrase.canonicalText,
      observedSource: phrase.variants.some((variant) => variant.source === "observed_cloze")
        ? "observed_cloze" as const
        : "observed_card" as const,
      ...(migrationCard && isChatHistoryMigrationCard(migrationCard.clientId, migrationCard.promptVersion)
        ? { billingExemptReason: "chat_history_migration" as const }
        : {}),
    };
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
        // The target occurrence may have been created earlier by generic phrase indexing.
        // Preserve the stronger cloze evidence before removing the temporary duplicate.
        await tx.$executeRawUnsafe(
          `UPDATE "phrase_occurrences" AS target
              SET "clozeBlankId" = COALESCE(target."clozeBlankId", duplicate."clozeBlankId"),
                  "matchType" = CASE
                    WHEN duplicate."clozeBlankId" IS NOT NULL THEN duplicate."matchType"
                    ELSE target."matchType"
                  END,
                  "updatedAt" = CURRENT_TIMESTAMP
             FROM "phrase_occurrences" AS duplicate
            WHERE duplicate."phraseId" = $1
              AND target."phraseId" = $2
              AND target."cardId" = duplicate."cardId"
              AND target."sourceField" = duplicate."sourceField"
              AND target."segmentKey" = duplicate."segmentKey"
              AND target."startUtf16" = duplicate."startUtf16"
              AND target."endUtf16" = duplicate."endUtf16"`,
          temporary.id,
          targetId,
        );
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

  async completePhraseHistoryJob(job: CardEnrichmentJobEntity): Promise<boolean> {
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
      return claimed.count === 1;
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
        rewrittenText: true,
        segments: { orderBy: { ordinal: "asc" }, select: { id: true, text: true } },
      },
    });
    if (!card?.originalText) return null;
    const currentInputHash = createHash("sha256")
      .update(buildCardEmbeddingInput(card.originalText, card.rewrittenText ?? ""))
      .digest("hex");
    if (currentInputHash !== job.inputHash) return null;
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
      const card = await tx.card.findFirst({
        where: { id: job.sourceId, userId: job.userId, status: "completed", deletedAt: null },
        select: { originalText: true, rewrittenText: true },
      });
      if (!card?.originalText) return false;
      const currentInputHash = createHash("sha256")
        .update(buildCardEmbeddingInput(card.originalText, card.rewrittenText ?? ""))
        .digest("hex");
      if (currentInputHash !== job.inputHash) return false;
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
      select: { id: true, userId: true, languageCode: true, createdAt: true, originalText: true, rewrittenText: true, clientId: true, promptVersion: true },
    });
    if (!card?.originalText) return null;
    const currentInputHash = createHash("sha256")
      .update(buildCardEmbeddingInput(card.originalText, card.rewrittenText ?? ""))
      .digest("hex");
    if (currentInputHash !== job.inputHash) return null;
    return {
      userId: card.userId,
      sourceKind: "card",
      sourceId: card.id,
      languageCode: card.languageCode,
      cardCreatedAt: card.createdAt,
      originalText: card.originalText,
      ...(isChatHistoryMigrationCard(card.clientId, card.promptVersion) ? { billingExemptReason: "chat_history_migration" as const } : {}),
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
        select: { createdAt: true, languageCode: true, originalText: true, rewrittenText: true },
      });
      if (!card?.originalText) return false;
      const currentInputHash = createHash("sha256")
        .update(buildCardEmbeddingInput(card.originalText, card.rewrittenText ?? ""))
        .digest("hex");
      if (currentInputHash !== job.inputHash) return false;
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
          const billingExemption = migrationBillingExemptionFromPayload(job.payload);
          const normalizationPayload = {
            phraseId: phrase.id,
            schemaVersion: 1,
            allowObservedCard: true,
            ...(billingExemption ? { billingExemptReason: billingExemption } : {}),
          };
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
              payload: normalizationPayload,
            },
            update: billingExemption ? { payload: normalizationPayload } : {},
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
      select: { originalText: true, rewrittenText: true },
    });
    if (!card?.originalText) return null;
    return {
      userId: job.userId,
      sourceKind: job.sourceKind,
      sourceId: job.sourceId,
      originalText: card.originalText,
      rewrittenText: card.rewrittenText ?? "",
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

  async rescheduleOrFail(
    job: CardEnrichmentJobEntity,
    errorMessage: string,
    availableAt: Date | null,
    options: { preserveAttempt?: boolean } = {},
  ): Promise<boolean> {
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
        ...(options.preserveAttempt ? { attempts: { decrement: 1 } } : {}),
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

function toJob(row: {
  id: string;
  userId: string;
  sourceKind: string;
  sourceId: string;
  jobType: string;
  attempts: number;
  priority: number;
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
    priority: Number(row.priority) || 0,
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

function auxiliaryLocaleFromPayload(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const appLocale = (payload as { appLocale?: unknown }).appLocale;
    if (typeof appLocale === "string" && appLocale.trim()) return appLocale;
  }
  throw new Error("CARD_AUXILIARY_LOCALE_MISSING");
}

function imageDescriptionPayload(payload: unknown): { promptVersion: string; resultVersion: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as { schemaVersion?: unknown; promptVersion?: unknown; resultVersion?: unknown };
  if (value.schemaVersion !== CARD_IMAGE_DESCRIPTION_PAYLOAD_SCHEMA_VERSION
    || typeof value.promptVersion !== "string"
    || typeof value.resultVersion !== "string"
    || !value.promptVersion
    || !value.resultVersion) return null;
  return { promptVersion: value.promptVersion, resultVersion: value.resultVersion };
}

function cardContentHash(text: string): string {
  const normalized = text.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

function migrationBillingExemptionFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const reason = (payload as { billingExemptReason?: unknown }).billingExemptReason;
  return reason === "chat_history_migration" ? reason : null;
}

function isChatHistoryMigrationCard(clientId: string, promptVersion: string): boolean {
  return clientId.startsWith("legacy_chat_to_card_v1:")
    || (clientId.startsWith("chat-message:v1:") && promptVersion.startsWith("legacy_chat_to_card_"));
}
