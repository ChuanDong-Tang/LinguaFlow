import { CARD_TOPIC_MAX_CHARS } from "@lf/core/Prompts/cardExpressionPrompt.js";
import { truncateGraphemes } from "@lf/core/text/grapheme.js";
import { cardRecordId, parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { PrismaCardRelationRepository } from "../../infrastructure/repository/PrismaCardRelationRepository.js";
import type { CardImageService } from "./CardImageService.js";

export interface CardRelationPreview {
  id: string;
  source: "card";
  title: string | null;
  displayTitle: string;
  topic: string | null;
  collectionId: string | null;
  dateKey: string;
  originalText: string;
  rewrittenText: string;
  languageCode: string;
  isSample: boolean;
  recordedAt: string;
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
    private readonly options: { modelVersion: string | null; minTopicSimilarity: number; minLanguageSimilarity?: number; topicMaxChars?: number },
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
      currentSegmentId: string | null;
      currentSurfaceText: string;
      currentStartUtf16: number;
      currentEndUtf16: number;
      currentSentence: string;
      matchMode: "semantic" | "exact";
      semanticScore?: number;
    };
  }>> {
    const ref = parseCardRecordId(recordId);
    if (!ref) return [];
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit!)))
      : 30;
    const [semanticRows, exactRows] = await Promise.all([
      this.options.modelVersion
        ? this.repository.findSemanticallyRelatedPhrases({
            userId,
            sourceId: ref.sourceId,
            modelVersion: this.options.modelVersion,
            minSimilarity: this.options.minLanguageSimilarity ?? 0.72,
            limit,
          })
        : [],
      this.repository.findRelatedPhrases({ userId, sourceKind: ref.source, sourceId: ref.sourceId, limit }),
    ]);
    const rows = [
      ...semanticRows.map((row) => ({ ...row, matchMode: "semantic" as const })),
      ...exactRows.map((row) => ({ ...row, matchMode: "exact" as const, semanticScore: undefined })),
    ].filter((row, index, all) => all.findIndex((candidate) => candidate.sourceId === row.sourceId) === index).slice(0, limit);
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
        currentSegmentId: row.currentSegmentId,
        currentSurfaceText: row.currentSurfaceText,
        currentStartUtf16: row.currentStartUtf16,
        currentEndUtf16: row.currentEndUtf16,
        currentSentence: row.currentSentence,
        matchMode: row.matchMode,
        ...(row.semanticScore === undefined ? {} : { semanticScore: row.semanticScore }),
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

  async relations(userId: string, recordId: string, _requestedLimit?: number): Promise<Array<{
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
          currentSegmentId: string | null;
          currentSurfaceText: string;
          currentStartUtf16: number;
          currentEndUtf16: number;
          currentSentence: string;
          matchMode: "semantic" | "exact";
          semanticScore?: number;
        }
    >;
  }>> {
    const [topics, phrases] = await Promise.all([
      this.relatedTopics(userId, recordId, 50),
      this.relatedPhrases(userId, recordId, 100),
    ]);
    type RelationReason =
      | (typeof topics)[number]["reason"]
      | (typeof phrases)[number]["reason"];
    const selected: Array<{ recordId: string; topic: string | null; reasons: RelationReason[] }> = [];
    const add = (item: { recordId: string; topic: string | null; reason: RelationReason }) => {
      const existing = selected.find((candidate) => candidate.recordId === item.recordId);
      if (existing) {
        if (!existing.reasons.some((reason) => relationReasonKey(reason) === relationReasonKey(item.reason))) existing.reasons.push(item.reason);
      } else selected.push({ recordId: item.recordId, topic: item.topic, reasons: [item.reason] });
    };
    for (const phrase of phrases.slice(0, 4)) add(phrase);
    const topic = topics[0];
    if (topic) add(topic);
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
        title: preview.title,
        displayTitle: relationDisplayTitle(preview, this.options.topicMaxChars),
        topic: preview.topic,
        collectionId: preview.collectionId,
        dateKey: preview.dateKey,
        originalText: preview.originalText,
        rewrittenText: preview.rewrittenText,
        languageCode: preview.languageCode,
        isSample: preview.isSample,
        recordedAt: preview.recordedAt.toISOString(),
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

function relationReasonKey(reason: { type: string } & Record<string, unknown>): string {
  return `${reason.type}:${typeof reason.phraseId === "string" ? reason.phraseId : ""}`;
}

function relationDisplayTitle(
  preview: Pick<CardRelationPreview, "title" | "topic" | "originalText" | "rewrittenText">,
  requestedMaxChars?: number,
): string {
  if (!preview.originalText?.trim() && !preview.rewrittenText?.trim()) return "";
  const title = preview.title?.trim();
  if (title) return title;
  const maxChars = Number.isFinite(requestedMaxChars)
    ? Math.max(1, Math.floor(requestedMaxChars!))
    : CARD_TOPIC_MAX_CHARS;
  const topic = preview.topic?.trim();
  if (topic) return truncateGraphemes(topic, maxChars);
  const firstLine = (preview.originalText || preview.rewrittenText)
    .split(/\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  return truncateGraphemes(firstLine, maxChars);
}
