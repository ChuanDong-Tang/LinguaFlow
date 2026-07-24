import { cardRecordId, parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { PrismaCardRelationRepository } from "../../infrastructure/repository/PrismaCardRelationRepository.js";
import type { CardImageService } from "./CardImageService.js";

export interface CardRelationPreview {
  id: string;
  source: "card";
  topic: string | null;
  collectionId: string | null;
  dateKey: string;
  originalText: string;
  rewrittenText: string;
  languageCode: string;
  isSample: boolean;
  createdAt: string;
  thumbnail: {
    url: string;
    urlExpiresAt: string | null;
    width: number;
    height: number;
  } | null;
}

export class CardRelationService {
  constructor(
    private readonly repository: PrismaCardRelationRepository,
    private readonly options: { modelVersion: string | null; minTopicSimilarity: number },
    private readonly imageService?: CardImageService,
  ) {}

  async relatedTopics(userId: string, recordId: string, requestedLimit?: number): Promise<Array<{
    recordId: string;
    topic: string;
    reason: { type: "topic"; score: number; modelVersion: string };
  }>> {
    const ref = parseCardRecordId(recordId);
    const modelVersion = this.options.modelVersion;
    if (!ref || !modelVersion) return [];
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(50, Math.floor(requestedLimit!)))
      : 10;
    const rows = await this.repository.findRelatedTopics({
      userId,
      sourceKind: ref.source,
      sourceId: ref.sourceId,
      modelVersion,
      minSimilarity: this.options.minTopicSimilarity,
      limit,
    });
    return rows.map((row) => ({
      recordId: cardRecordId("card", row.sourceId),
      topic: row.topic,
      reason: {
        type: "topic",
        score: row.score,
        modelVersion,
      },
    }));
  }

  async relatedPhrases(userId: string, recordId: string, requestedLimit?: number): Promise<Array<{
    recordId: string;
    topic: string | null;
    reason: {
      type: "phrase";
      phraseId: string;
      phrase: string;
      evidence: "clozed" | "appeared";
      surfaceText: string;
      sentence: string;
    };
  }>> {
    const ref = parseCardRecordId(recordId);
    if (!ref) return [];
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit!)))
      : 30;
    const rows = await this.repository.findRelatedPhrases({
      userId,
      sourceKind: ref.source,
      sourceId: ref.sourceId,
      limit,
    });
    return rows.map((row) => ({
      recordId: cardRecordId("card", row.sourceId),
      topic: row.topic,
      reason: {
        type: "phrase",
        phraseId: row.phraseId,
        phrase: row.phrase,
        evidence: row.evidence,
        surfaceText: row.surfaceText,
        sentence: row.sentence,
      },
    }));
  }

  async progress(userId: string, recordId: string, requestedLimit?: number): Promise<Array<{
    recordId: string;
    topic: string | null;
    reason: {
      type: "progress";
      phraseId: string;
      phrase: string;
      previousExpression: string;
      currentExpression: string;
      isFirstUserProduced: boolean;
    };
  }>> {
    const ref = parseCardRecordId(recordId);
    if (!ref) return [];
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit!)))
      : 30;
    const rows = await this.repository.findProgressRelations({
      userId,
      sourceKind: ref.source,
      sourceId: ref.sourceId,
      limit,
    });
    return rows.map((row) => ({
      recordId: cardRecordId("card", row.sourceId),
      topic: row.topic,
      reason: {
        type: "progress",
        phraseId: row.phraseId,
        phrase: row.phrase,
        previousExpression: row.historicalSurfaceText,
        currentExpression: row.currentSurfaceText,
        isFirstUserProduced: row.isFirstUserProduced,
      },
    }));
  }

  async phraseOccurrences(userId: string, phraseId: string, cursor?: string, requestedLimit?: number) {
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit!)))
      : 30;
    const result = await this.repository.findPhraseOccurrenceHistory({
      userId,
      phraseId: phraseId.trim(),
      cursorId: cursor?.trim() || undefined,
      limit,
    });
    return {
      items: result.items.map((row) => ({
        occurrenceId: row.id,
        recordId: cardRecordId("card", row.sourceId),
        topic: row.topic,
        sourceField: row.sourceField,
        surfaceText: row.surfaceText,
        evidence: row.evidence,
        cardCreatedAt: row.cardCreatedAt,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async relations(userId: string, recordId: string, requestedLimit?: number): Promise<Array<{
    recordId: string;
    topic: string | null;
    card: CardRelationPreview | null;
    reasons: Array<
      | { type: "topic"; score: number; modelVersion: string }
      | {
          type: "phrase";
          phraseId: string;
          phrase: string;
          evidence: "clozed" | "appeared";
          surfaceText: string;
          sentence: string;
        }
      | {
          type: "progress";
          phraseId: string;
          phrase: string;
          previousExpression: string;
          currentExpression: string;
          isFirstUserProduced: boolean;
        }
    >;
  }>> {
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(50, Math.floor(requestedLimit!)))
      : 20;
    const [topics, phrases, progress] = await Promise.all([
      this.relatedTopics(userId, recordId, 50),
      this.relatedPhrases(userId, recordId, 100),
      this.progress(userId, recordId, 100),
    ]);
    type RelationReason =
      | (typeof topics)[number]["reason"]
      | (typeof phrases)[number]["reason"]
      | (typeof progress)[number]["reason"];
    const byRecord = new Map<string, { recordId: string; topic: string | null; reasons: RelationReason[] }>();
    for (const item of [...progress, ...phrases, ...topics]) {
      const existing = byRecord.get(item.recordId) ?? { recordId: item.recordId, topic: item.topic, reasons: [] };
      if (!existing.topic && item.topic) existing.topic = item.topic;
      if (!existing.reasons.some((reason) => reasonKey(reason) === reasonKey(item.reason))) {
        existing.reasons.push(item.reason);
      }
      byRecord.set(item.recordId, existing);
    }
    const selected = Array.from(byRecord.values())
      .sort((left, right) => {
        if (right.reasons.length !== left.reasons.length) return right.reasons.length - left.reasons.length;
        return relationPriority(right.reasons) - relationPriority(left.reasons);
      })
      .slice(0, limit);
    const refs = selected.flatMap((item) => {
      const ref = parseCardRecordId(item.recordId);
      return ref ? [{ sourceKind: ref.source, sourceId: ref.sourceId }] : [];
    });
    const previews = await this.repository.findRelationPreviews({ userId, refs });
    const previewById = new Map(await Promise.all(previews.map(async (preview) => {
      let thumbnail: CardRelationPreview["thumbnail"] = null;
      if (preview.image && this.imageService) {
        try {
          thumbnail = (await this.imageService.views(preview.image)).thumbnail;
        } catch {
          // A signed image URL failure must not hide the relation itself.
        }
      }
      return [preview.recordId, {
        id: preview.recordId,
        source: preview.source,
        topic: preview.topic,
        collectionId: preview.collectionId,
        dateKey: preview.dateKey,
        originalText: preview.originalText,
        rewrittenText: preview.rewrittenText,
        languageCode: preview.languageCode,
        isSample: preview.isSample,
        createdAt: preview.createdAt.toISOString(),
        thumbnail,
      } satisfies CardRelationPreview] as const;
    })));
    return selected.map((item) => ({
      ...item,
      card: previewById.get(item.recordId) ?? null,
    }));
  }
}

function reasonKey(reason: { type: string; phraseId?: string; evidence?: string }): string {
  return `${reason.type}:${reason.phraseId ?? ""}:${reason.evidence ?? ""}`;
}

function relationPriority(reasons: Array<{ type: string }>): number {
  if (reasons.some((reason) => reason.type === "progress")) return 3;
  if (reasons.some((reason) => reason.type === "phrase")) return 2;
  return 1;
}
