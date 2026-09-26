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
  currentSegmentId: string | null;
  currentSurfaceText: string;
  currentStartUtf16: number;
  currentEndUtf16: number;
  currentSentence: string;
  cardCreatedAt: Date;
}

export interface SemanticPhraseRelationRow extends RelatedPhraseRow {
  semanticScore: number;
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
  title: string | null;
  topic: string | null;
  collectionId: string | null;
  dateKey: string;
  originalText: string;
  rewrittenText: string;
  languageCode: string;
  isSample: boolean;
  recordedAt: Date;
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
      include: { images: { orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }], take: 1 } },
    });
    const rows: CardRelationPreviewRow[] = cards.map((card) => ({
      recordId: `card:${card.id}`,
      source: "card",
      title: card.title,
      topic: card.topic,
      collectionId: card.collectionId,
      dateKey: card.dateKey,
      originalText: card.originalText ?? "",
      rewrittenText: card.rewrittenText ?? "",
      languageCode: card.languageCode,
      isSample: card.isSample,
      recordedAt: card.recordedAt,
      createdAt: card.createdAt,
      image: (card.images[0] as CardImageAssetEntity | undefined) ?? null,
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

  async findSemanticallyRelatedPhrases(input: {
    userId: string;
    sourceId: string;
    modelVersion: string;
    minSimilarity: number;
    limit: number;
  }): Promise<SemanticPhraseRelationRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<SemanticPhraseRelationRow & { semanticScore: number | string }>>(
      `WITH anchors AS (
         SELECT DISTINCT ON (occurrence."phraseId")
                occurrence."phraseId", occurrence."segmentId", occurrence."surfaceText",
                occurrence."startUtf16", occurrence."endUtf16",
                COALESCE(current_segment."text", occurrence."surfaceText") AS "currentSentence",
                current_phrase."languageCode", current_embedding."embedding"
           FROM "phrase_occurrences" AS occurrence
           JOIN "phrases" AS current_phrase
             ON current_phrase."id" = occurrence."phraseId"
            AND current_phrase."userId" = occurrence."userId"
            AND current_phrase."status" = 'normalized'
           JOIN "phrase_embeddings" AS current_embedding
             ON current_embedding."phraseId" = occurrence."phraseId"
            AND current_embedding."userId" = occurrence."userId"
            AND current_embedding."modelVersion" = $3
           LEFT JOIN "card_rewrite_segments" AS current_segment
             ON current_segment."id" = occurrence."segmentId"
          WHERE occurrence."userId" = $1
            AND occurrence."cardId" = $2
            AND occurrence."sourceField" = 'ai_expression'
            AND occurrence."clozeBlankId" IS NOT NULL
          ORDER BY occurrence."phraseId", occurrence."updatedAt" DESC, occurrence."id" DESC
       )
       SELECT candidate_phrase."id" AS "phraseId",
              candidate_phrase."canonicalText" AS "phrase",
              'card'::text AS "sourceKind",
              historical."cardId" AS "sourceId",
              historical."topic",
              historical."evidence",
              historical."surfaceText",
              historical."sentence",
              anchors."segmentId" AS "currentSegmentId",
              anchors."surfaceText" AS "currentSurfaceText",
              anchors."startUtf16" AS "currentStartUtf16",
              anchors."endUtf16" AS "currentEndUtf16",
              anchors."currentSentence",
              historical."cardCreatedAt",
              (1 - (candidate_embedding."embedding" <=> anchors."embedding"))::double precision AS "semanticScore"
         FROM anchors
         JOIN "phrase_embeddings" AS candidate_embedding
           ON candidate_embedding."userId" = $1
          AND candidate_embedding."modelVersion" = $3
          AND candidate_embedding."phraseId" <> anchors."phraseId"
         JOIN "phrases" AS candidate_phrase
           ON candidate_phrase."id" = candidate_embedding."phraseId"
          AND candidate_phrase."userId" = $1
          AND candidate_phrase."languageCode" = anchors."languageCode"
          AND candidate_phrase."status" = 'normalized'
         JOIN LATERAL (
           SELECT occurrence."cardId", card."topic",
                  CASE WHEN occurrence."clozeBlankId" IS NULL THEN 'appeared' ELSE 'clozed' END AS "evidence",
                  occurrence."surfaceText", COALESCE(segment."text", occurrence."surfaceText") AS "sentence",
                  occurrence."cardCreatedAt"
             FROM "phrase_occurrences" AS occurrence
             JOIN "cards" AS card
               ON card."id" = occurrence."cardId"
              AND card."userId" = occurrence."userId"
              AND card."status" = 'completed'
              AND card."deletedAt" IS NULL
             LEFT JOIN "card_rewrite_segments" AS segment ON segment."id" = occurrence."segmentId"
            WHERE occurrence."userId" = $1
              AND occurrence."phraseId" = candidate_phrase."id"
              AND occurrence."sourceField" = 'ai_expression'
              AND occurrence."cardId" <> $2
            ORDER BY (occurrence."clozeBlankId" IS NOT NULL) DESC, occurrence."cardCreatedAt" DESC, occurrence."id" DESC
            LIMIT 1
         ) AS historical ON TRUE
        WHERE (1 - (candidate_embedding."embedding" <=> anchors."embedding")) >= $4
        ORDER BY "semanticScore" DESC, historical."cardCreatedAt" DESC, historical."cardId" ASC
        LIMIT $5`,
      input.userId,
      input.sourceId,
      input.modelVersion,
      input.minSimilarity,
      input.limit,
    );
    return rows.map((row) => ({ ...row, semanticScore: Number(row.semanticScore) }));
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

}
