import type { CardImageAssetEntity } from "@lf/core/ports/repository/CardRepository.js";
import type { PrismaClient } from "@prisma/client";

export interface RelatedTopicRow {
  sourceKind: string;
  sourceId: string;
  topic: string;
  score: number;
}

export interface RelatedPhraseRow {
  phraseId: string;
  phrase: string;
  sourceKind: string;
  sourceId: string;
  topic: string | null;
  evidence: "clozed" | "appeared";
  surfaceText: string;
  sentence: string;
  cardCreatedAt: Date;
}

export interface ProgressRelationRow {
  phraseId: string;
  phrase: string;
  currentSurfaceText: string;
  historicalSurfaceText: string;
  isFirstUserProduced: boolean;
  sourceKind: string;
  sourceId: string;
  topic: string | null;
  cardCreatedAt: Date;
}

export interface PhraseOccurrenceHistoryRow {
  id: string;
  sourceKind: string;
  sourceId: string;
  sourceField: "original" | "ai_expression";
  surfaceText: string;
  evidence: "clozed" | "appeared" | "user_produced";
  cardCreatedAt: Date;
  topic: string | null;
}

export interface CardRelationPreviewRow {
  recordId: string;
  source: "card";
  topic: string | null;
  collectionId: string | null;
  dateKey: string;
  originalText: string;
  rewrittenText: string;
  languageCode: string;
  isSample: boolean;
  createdAt: Date;
  image: CardImageAssetEntity | null;
}

export class PrismaCardRelationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findRelationPreviews(input: {
    userId: string;
    refs: Array<{ sourceKind: "card"; sourceId: string }>;
  }): Promise<CardRelationPreviewRow[]> {
    if (!input.refs.length) return [];
    const cards = await this.prisma.card.findMany({
      where: {
        id: { in: input.refs.map((ref) => ref.sourceId) },
        userId: input.userId,
        status: "completed",
        deletedAt: null,
      },
      include: { image: true },
    });
    const rows: CardRelationPreviewRow[] = cards.map((card) => ({
      recordId: `card:${card.id}`,
      source: "card",
      topic: card.topic,
      collectionId: card.collectionId,
      dateKey: card.dateKey,
      originalText: card.originalText ?? "",
      rewrittenText: card.rewrittenText ?? "",
      languageCode: card.languageCode,
      isSample: card.isSample,
      createdAt: card.createdAt,
      image: card.image as CardImageAssetEntity | null,
    }));
    const byRecordId = new Map(rows.map((row) => [row.recordId, row]));
    return input.refs.flatMap((ref) => {
      const row = byRecordId.get(`${ref.sourceKind}:${ref.sourceId}`);
      return row ? [row] : [];
    });
  }

  async findRelatedTopics(input: {
    userId: string;
    sourceKind: string;
    sourceId: string;
    modelVersion: string;
    minSimilarity: number;
    limit: number;
  }): Promise<RelatedTopicRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        sourceKind: string;
        sourceId: string;
        topic: string;
        score: number;
      }>
    >(
      `SELECT 'card'::text AS "sourceKind",
              candidate."cardId" AS "sourceId",
              candidate_card."topic",
              (1 - (candidate."embedding" <=> current_embedding."embedding"))::double precision AS "score"
         FROM "card_embeddings" AS current_embedding
         JOIN "card_embeddings" AS candidate
           ON candidate."userId" = current_embedding."userId"
          AND candidate."modelVersion" = current_embedding."modelVersion"
         JOIN "cards" AS candidate_card
           ON candidate_card."id" = candidate."cardId"
          AND candidate_card."userId" = candidate."userId"
          AND candidate_card."status" = 'completed'
          AND candidate_card."deletedAt" IS NULL
        WHERE current_embedding."userId" = $1
          AND current_embedding."cardId" = $2
          AND current_embedding."modelVersion" = $3
          AND candidate."cardId" <> $2
          AND candidate_card."topic" IS NOT NULL
          AND (1 - (candidate."embedding" <=> current_embedding."embedding")) >= $4
        ORDER BY candidate."embedding" <=> current_embedding."embedding" ASC,
                 candidate."cardId" ASC
        LIMIT $5`,
      input.userId,
      input.sourceId,
      input.modelVersion,
      input.minSimilarity,
      input.limit,
    );
    return rows.map((row) => ({ ...row, score: Number(row.score) }));
  }

  async findRelatedPhrases(input: {
    userId: string;
    sourceKind: string;
    sourceId: string;
    limit: number;
  }): Promise<RelatedPhraseRow[]> {
    return this.prisma.$queryRawUnsafe<RelatedPhraseRow[]>(
      `WITH anchors AS (
         SELECT DISTINCT occurrence."phraseId", occurrence."cardCreatedAt"
          FROM "phrase_occurrences" AS occurrence
          WHERE occurrence."userId" = $1
            AND occurrence."cardId" = $2
            AND occurrence."sourceField" = 'ai_expression'
            AND occurrence."clozeBlankId" IS NOT NULL
       ), deduplicated AS (
         SELECT DISTINCT ON (historical."cardId", historical."phraseId")
              historical."phraseId",
              phrase."canonicalText" AS "phrase",
              'card'::text AS "sourceKind",
              historical."cardId" AS "sourceId",
              historical_card."topic",
              CASE WHEN historical."clozeBlankId" IS NULL THEN 'appeared' ELSE 'clozed' END AS "evidence",
              historical."surfaceText",
              COALESCE(segment."text", historical."surfaceText") AS "sentence",
              historical."cardCreatedAt"
         FROM anchors
         JOIN "phrase_occurrences" AS historical
           ON historical."phraseId" = anchors."phraseId"
          AND historical."userId" = $1
          AND historical."sourceField" = 'ai_expression'
          AND historical."cardCreatedAt" < anchors."cardCreatedAt"
         JOIN "phrases" AS phrase ON phrase."id" = historical."phraseId" AND phrase."userId" = $1
         JOIN "cards" AS historical_card
           ON historical_card."id" = historical."cardId"
          AND historical_card."userId" = historical."userId"
          AND historical_card."status" = 'completed'
          AND historical_card."deletedAt" IS NULL
         LEFT JOIN "card_rewrite_segments" AS segment
           ON segment."id" = historical."segmentId"
        WHERE historical."cardId" <> $2
        ORDER BY historical."cardId", historical."phraseId",
                 (historical."clozeBlankId" IS NOT NULL) DESC, historical."cardCreatedAt" DESC
       )
       SELECT * FROM deduplicated
        ORDER BY "cardCreatedAt" DESC, "sourceId" DESC
        LIMIT $3`,
      input.userId,
      input.sourceId,
      input.limit,
    );
  }

  async findPhraseOccurrenceHistory(input: {
    userId: string;
    phraseId: string;
    cursorId?: string;
    limit: number;
  }): Promise<{
    items: PhraseOccurrenceHistoryRow[];
    nextCursor: string | null;
  }> {
    const phrase = await this.prisma.phrase.findFirst({
      where: { id: input.phraseId, userId: input.userId },
      select: { id: true },
    });
    if (!phrase) return { items: [], nextCursor: null };
    const rows = await this.prisma.phraseOccurrence.findMany({
      where: { userId: input.userId, phraseId: input.phraseId },
      include: { card: { select: { topic: true } } },
      orderBy: [{ cardCreatedAt: "desc" }, { id: "desc" }],
      cursor: input.cursorId ? { id: input.cursorId } : undefined,
      skip: input.cursorId ? 1 : 0,
      take: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        sourceKind: "card",
        sourceId: row.cardId,
        sourceField: row.sourceField as "original" | "ai_expression",
        surfaceText: row.surfaceText,
        evidence:
          row.sourceField === "original"
            ? "user_produced"
            : row.clozeBlankId
              ? "clozed"
              : "appeared",
        cardCreatedAt: row.cardCreatedAt,
        topic: row.card.topic,
      })),
      nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async findProgressRelations(input: {
    userId: string;
    sourceKind: string;
    sourceId: string;
    limit: number;
  }): Promise<ProgressRelationRow[]> {
    return this.prisma.$queryRawUnsafe<ProgressRelationRow[]>(
      `WITH anchors AS (
         SELECT occurrence."phraseId", occurrence."cardCreatedAt", occurrence."surfaceText"
           FROM "phrase_occurrences" AS occurrence
          WHERE occurrence."userId" = $1
            AND occurrence."cardId" = $2
            AND occurrence."sourceField" = 'original'
       ), deduplicated AS (
         SELECT DISTINCT ON (historical."cardId", historical."phraseId")
                historical."phraseId",
                phrase."canonicalText" AS "phrase",
                anchors."surfaceText" AS "currentSurfaceText",
                historical."surfaceText" AS "historicalSurfaceText",
                NOT EXISTS (
                  SELECT 1 FROM "phrase_occurrences" AS previous_user
                   WHERE previous_user."userId" = $1
                     AND previous_user."phraseId" = anchors."phraseId"
                     AND previous_user."sourceField" = 'original'
                     AND previous_user."cardCreatedAt" < anchors."cardCreatedAt"
                ) AS "isFirstUserProduced",
                'card'::text AS "sourceKind",
                historical."cardId" AS "sourceId",
                historical_card."topic",
                historical."cardCreatedAt"
           FROM anchors
           JOIN "phrase_occurrences" AS historical
             ON historical."phraseId" = anchors."phraseId"
            AND historical."userId" = $1
            AND historical."sourceField" = 'ai_expression'
            AND historical."cardCreatedAt" < anchors."cardCreatedAt"
           JOIN "phrases" AS phrase ON phrase."id" = historical."phraseId" AND phrase."userId" = $1
           JOIN "cards" AS historical_card
             ON historical_card."id" = historical."cardId"
            AND historical_card."userId" = historical."userId"
            AND historical_card."status" = 'completed'
            AND historical_card."deletedAt" IS NULL
          WHERE historical."cardId" <> $2
          ORDER BY historical."cardId", historical."phraseId",
                   historical."cardCreatedAt" DESC
       )
       SELECT * FROM deduplicated
        ORDER BY "cardCreatedAt" DESC, "sourceId" DESC
        LIMIT $3`,
      input.userId,
      input.sourceId,
      input.limit,
    );
  }
}
