import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PhraseRelationJudgeCandidate,
  PhraseRelationJudgeOccurrence,
  PhraseRelationJudgeSource,
} from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import { PHRASE_RELATION_JUDGE_MAX_CANDIDATES } from "@lf/core/Prompts/phraseRelationJudgePrompt.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface PhraseRelationRetrievalConfig {
  modelVersion: string;
  representationVersion: string;
  minPhraseSimilarity: number;
  minRepresentationSimilarity: number;
  representationWeight: number;
}

export async function loadPhraseRelationJudgeSourceData(
  prisma: DbClient,
  occurrenceId: string,
  userId: string,
  config: PhraseRelationRetrievalConfig,
): Promise<PhraseRelationJudgeSource | null> {
  const anchors = await prisma.$queryRaw<Array<PhraseRelationJudgeOccurrence>>`
    SELECT occurrence."id" AS "occurrenceId", phrase."languageCode",
           occurrence."surfaceText", segment."text" AS "sentence",
           occurrence."startUtf16", occurrence."endUtf16"
      FROM "phrase_occurrences" AS occurrence
      JOIN "phrases" AS phrase
        ON phrase."id" = occurrence."phraseId"
       AND phrase."userId" = occurrence."userId"
       AND phrase."status" = 'normalized'
      JOIN LATERAL (
        SELECT rewrite_segment."text"
          FROM "card_rewrite_segments" AS rewrite_segment
         WHERE rewrite_segment."entryId" = occurrence."cardId"
           AND (rewrite_segment."id" = occurrence."segmentId"
             OR position(lower(occurrence."surfaceText") in lower(rewrite_segment."text")) > 0)
         ORDER BY (rewrite_segment."id" = occurrence."segmentId") DESC, rewrite_segment."ordinal" ASC
         LIMIT 1
      ) AS segment ON TRUE
     WHERE occurrence."id" = ${occurrenceId}
       AND occurrence."userId" = ${userId}
       AND occurrence."sourceField" = 'ai_expression'
       AND occurrence."clozeBlankId" IS NOT NULL
     LIMIT 1
  `;
  const anchor = anchors[0];
  if (!anchor) return null;

  const rows = await prisma.$queryRaw<Array<PhraseRelationJudgeCandidate & { semanticScore: number | string }>>`
    WITH anchor AS (
      SELECT occurrence."id", occurrence."phraseId", occurrence."cardId", phrase."languageCode",
             phrase_embedding."embedding" AS "phraseEmbedding"
        FROM "phrase_occurrences" AS occurrence
        JOIN "phrases" AS phrase
          ON phrase."id" = occurrence."phraseId" AND phrase."userId" = occurrence."userId"
        JOIN "phrase_embeddings" AS phrase_embedding
          ON phrase_embedding."phraseId" = occurrence."phraseId"
         AND phrase_embedding."userId" = occurrence."userId"
         AND phrase_embedding."modelVersion" = ${config.modelVersion}
       WHERE occurrence."id" = ${occurrenceId} AND occurrence."userId" = ${userId}
    ), scored AS (
      SELECT historical."id" AS "occurrenceId", candidate_phrase."languageCode",
             historical."surfaceText", historical_segment."text" AS "sentence",
             historical."startUtf16", historical."endUtf16",
             (1 - (candidate_phrase_embedding."embedding" <=> anchor."phraseEmbedding"))::double precision AS "semanticScore",
             historical."cardCreatedAt",
             ROW_NUMBER() OVER (
               PARTITION BY historical."cardId"
               ORDER BY (1 - (candidate_phrase_embedding."embedding" <=> anchor."phraseEmbedding")) DESC,
                        historical."id" DESC
             ) AS "cardRank"
        FROM anchor
        JOIN "phrase_embeddings" AS candidate_phrase_embedding
          ON candidate_phrase_embedding."userId" = ${userId}
         AND candidate_phrase_embedding."modelVersion" = ${config.modelVersion}
         AND candidate_phrase_embedding."phraseId" <> anchor."phraseId"
        JOIN "phrases" AS candidate_phrase
          ON candidate_phrase."id" = candidate_phrase_embedding."phraseId"
         AND candidate_phrase."userId" = ${userId}
         AND candidate_phrase."languageCode" = anchor."languageCode"
         AND candidate_phrase."status" = 'normalized'
        JOIN "phrase_occurrences" AS historical
          ON historical."phraseId" = candidate_phrase."id"
         AND historical."userId" = ${userId}
         AND historical."sourceField" = 'ai_expression'
         AND historical."cardId" <> anchor."cardId"
        JOIN LATERAL (
          SELECT segment."text"
            FROM "card_rewrite_segments" AS segment
           WHERE segment."entryId" = historical."cardId"
             AND (segment."id" = historical."segmentId"
               OR position(lower(historical."surfaceText") in lower(segment."text")) > 0)
           ORDER BY (segment."id" = historical."segmentId") DESC, segment."ordinal" ASC
           LIMIT 1
        ) AS historical_segment ON TRUE
        JOIN "cards" AS historical_card
          ON historical_card."id" = historical."cardId"
         AND historical_card."userId" = ${userId}
         AND historical_card."status" = 'completed'
         AND historical_card."deletedAt" IS NULL
       WHERE (1 - (candidate_phrase_embedding."embedding" <=> anchor."phraseEmbedding")) >= ${config.minPhraseSimilarity}
    )
    SELECT "occurrenceId", "languageCode", "surfaceText", "sentence", "startUtf16", "endUtf16", "semanticScore"
      FROM scored
     WHERE "cardRank" = 1
     ORDER BY "semanticScore" DESC, "cardCreatedAt" DESC, "occurrenceId" ASC
     LIMIT ${PHRASE_RELATION_JUDGE_MAX_CANDIDATES}
  `;
  return {
    userId,
    anchor,
    candidates: rows.map((row) => ({ ...row, semanticScore: Number(row.semanticScore) })),
  };
}

export function phraseRelationRetrievalConfigFromPayload(payload: unknown): PhraseRelationRetrievalConfig | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.modelVersion !== "string" || typeof value.representationVersion !== "string") return null;
  const minPhraseSimilarity = Number(value.minPhraseSimilarity);
  const minRepresentationSimilarity = Number(value.minRepresentationSimilarity);
  const representationWeight = Number(value.representationWeight);
  if (![minPhraseSimilarity, minRepresentationSimilarity, representationWeight].every(Number.isFinite)) return null;
  return { modelVersion: value.modelVersion, representationVersion: value.representationVersion, minPhraseSimilarity, minRepresentationSimilarity, representationWeight };
}
