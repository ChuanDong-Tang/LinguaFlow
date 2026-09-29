import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PhraseRelationJudgeCandidate,
  PhraseRelationJudgeOccurrence,
  PhraseRelationJudgeSource,
} from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import { PHRASE_RELATION_JUDGE_MAX_CANDIDATES } from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import {
  PHRASE_RELATION_JUDGE_JOB_TYPE,
  PHRASE_RELATION_JUDGE_PROMPT_VERSION,
  PHRASE_RELATION_JUDGE_SOURCE_KIND,
  phraseRelationJudgeHashInput,
  phraseRelationJudgeInputVersion,
} from "@lf/core/Prompts/phraseRelationJudgePrompt.js";
import { createHash } from "node:crypto";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface PhraseRelationRetrievalConfig {
  modelVersion: string;
  representationVersion: string;
  minPhraseSimilarity: number;
  minRepresentationSimilarity: number;
  representationWeight: number;
}

export interface PhraseRelationJudgeEnqueueConfig extends PhraseRelationRetrievalConfig {
  promptVersion: string;
  priority?: number;
}

export function phraseRelationJudgeEnqueueConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PhraseRelationJudgeEnqueueConfig | null {
  const deployment = env.AZURE_EMBEDDING_DEPLOYMENT?.trim();
  if (!deployment) return null;
  const model = env.AZURE_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  const apiVersion = env.AZURE_EMBEDDING_API_VERSION?.trim() || "2024-10-21";
  const dimensions = positiveInt(env.AZURE_EMBEDDING_DIMENSIONS, 1536);
  return {
    promptVersion: PHRASE_RELATION_JUDGE_PROMPT_VERSION,
    modelVersion: `${model}:${deployment}:${apiVersion}:${dimensions}`,
    representationVersion: env.RELATED_PHRASE_CONTEXT_REPRESENTATION_VERSION?.trim() || "usage_meaning_v2",
    minPhraseSimilarity: unitFloat(env.RELATED_PHRASE_MIN_SIMILARITY, 0.72),
    minRepresentationSimilarity: unitFloat(env.RELATED_PHRASE_SENSE_MIN_SIMILARITY, 0.45),
    representationWeight: unitFloat(env.RELATED_PHRASE_SENSE_WEIGHT, 0.70),
  };
}

export async function enqueuePhraseRelationJudgeForOccurrence(
  tx: DbClient,
  input: { userId: string; occurrenceId: string } & PhraseRelationJudgeEnqueueConfig,
): Promise<boolean> {
  const ready = await tx.$queryRaw<Array<{ ready: number }>>`
    SELECT 1 AS "ready"
      FROM "phrase_occurrences" AS occurrence
      JOIN "phrase_embeddings" AS embedding
        ON embedding."phraseId" = occurrence."phraseId"
       AND embedding."userId" = occurrence."userId"
       AND embedding."modelVersion" = ${input.modelVersion}
     WHERE occurrence."id" = ${input.occurrenceId}
       AND occurrence."userId" = ${input.userId}
     LIMIT 1
  `;
  if (!ready[0]) return false;
  const config = {
    modelVersion: input.modelVersion,
    representationVersion: input.representationVersion,
    minPhraseSimilarity: input.minPhraseSimilarity,
    minRepresentationSimilarity: input.minRepresentationSimilarity,
    representationWeight: input.representationWeight,
  };
  const source = await loadPhraseRelationJudgeSourceData(tx, input.occurrenceId, input.userId, config);
  if (!source) return false;
  const inputHash = createHash("sha256").update(phraseRelationJudgeHashInput(source)).digest("hex");
  const decision = await tx.phraseOccurrenceRelationDecision.findUnique({
    where: { anchorOccurrenceId_promptVersion: { anchorOccurrenceId: input.occurrenceId, promptVersion: input.promptVersion } },
    select: { inputHash: true },
  });
  if (decision?.inputHash === inputHash) return false;
  const key = {
    userId: input.userId,
    sourceKind: PHRASE_RELATION_JUDGE_SOURCE_KIND,
    sourceId: input.occurrenceId,
    jobType: PHRASE_RELATION_JUDGE_JOB_TYPE,
    inputVersion: phraseRelationJudgeInputVersion(inputHash),
  };
  if (await tx.cardEnrichmentJob.findUnique({
    where: { userId_sourceKind_sourceId_jobType_inputVersion: key },
    select: { id: true },
  })) return false;
  await tx.cardEnrichmentJob.create({
    data: {
      ...key,
      inputHash,
      priority: input.priority ?? 0,
      payload: { schemaVersion: 1, promptVersion: input.promptVersion, ...config },
    },
  });
  return true;
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

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unitFloat(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
