import type { PrismaClient } from "@prisma/client";
import { cardRecordId, parseCardRecordId } from "@lf/core/types/cardRecord.js";

export interface RecallCandidate {
  recordId: string;
  topic: string | null;
  originalText: string;
  rewrittenText: string;
  createdAt: Date;
  reason: "long_unseen" | "has_connections" | "shuffle" | "search" | "semantic_search";
  semanticScore?: number;
  matches?: LexicalSearchMatch[];
}

export interface LexicalSearchMatch {
  field: "topic" | "original" | "ai_expression";
  matchType: "exact" | "variant";
  sentence: string;
  surfaceText: string;
  startUtf16: number | null;
  endUtf16: number | null;
  phraseId?: string;
}

export interface RecallReason {
  type: "topic" | "phrase" | "progress";
  phraseId?: string;
  [key: string]: unknown;
}

export interface RecallRelationInput {
  recordId: string;
  reasons: RecallReason[];
}

export class PrismaRecallRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async seedCandidates(userId: string, mode: "recommended" | "shuffle", excludedSourceIds: string[], limit: number): Promise<RecallCandidate[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        userId,
        status: "completed",
        deletedAt: null,
        isSample: false,
        id: excludedSourceIds.length ? { notIn: excludedSourceIds } : undefined,
      },
      select: {
        id: true,
        topic: true,
        originalText: true,
        rewrittenText: true,
        createdAt: true,
      },
      orderBy: mode === "shuffle" ? { updatedAt: "asc" } : { createdAt: "asc" },
      take: Math.min(50, Math.max(limit * 4, limit)),
    });
    const ordered = mode === "shuffle" ? stableShuffle(rows) : rows;
    const candidates: RecallCandidate[] = await Promise.all(ordered.slice(0, limit).map(async (card): Promise<RecallCandidate> => {
      const [occurrenceCount, embeddingCount] = await Promise.all([
        this.prisma.phraseOccurrence.count({ where: { userId, cardId: card.id } }),
        this.prisma.cardEmbedding.count({ where: { userId, cardId: card.id } }),
      ]);
      return {
        recordId: cardRecordId("card", card.id),
        topic: card.topic,
        originalText: card.originalText ?? "",
        rewrittenText: card.rewrittenText ?? "",
        createdAt: card.createdAt,
        reason: mode === "shuffle" ? "shuffle" : occurrenceCount + embeddingCount > 0 ? "has_connections" : "long_unseen",
      };
    }));
    return mode === "recommended"
      ? candidates.sort((left, right) => Number(right.reason === "has_connections") - Number(left.reason === "has_connections"))
      : candidates;
  }

  async searchCandidates(input: {
    userId: string;
    query: string;
    collectionId?: string | null;
    timeRange?: "recent" | "this_year" | "last_year" | "earlier";
    limit: number;
  }): Promise<RecallCandidate[]> {
    const now = new Date();
    const thisYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const lastYear = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    const recent = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);
    const createdAt = input.timeRange === "recent" ? { gte: recent }
      : input.timeRange === "this_year" ? { gte: thisYear }
        : input.timeRange === "last_year" ? { gte: lastYear, lt: thisYear }
          : input.timeRange === "earlier" ? { lt: lastYear }
            : undefined;
    const matchingPhrases = input.query ? await this.prisma.phrase.findMany({
      where: {
        userId: input.userId,
        OR: [
          { canonicalText: { contains: input.query, mode: "insensitive" } },
          { variants: { some: { surfaceText: { contains: input.query, mode: "insensitive" } } } },
        ],
      },
      select: { id: true },
      take: 50,
    }) : [];
    const matchingPhraseIds = matchingPhrases.map((item) => item.id);
    const phraseCardIds = matchingPhraseIds.length ? (await this.prisma.phraseOccurrence.findMany({
      where: {
        userId: input.userId,
        phraseId: { in: matchingPhraseIds },
      },
      select: { cardId: true },
      distinct: ["cardId"],
      take: input.limit * 4,
    })).map((item) => item.cardId) : [];
    const cards = await this.prisma.card.findMany({
      where: {
        userId: input.userId,
        status: "completed",
        deletedAt: null,
        isSample: false,
        createdAt,
        ...(input.collectionId !== undefined ? { collectionId: input.collectionId } : {}),
        ...(input.query ? {
          OR: [
            { topic: { contains: input.query, mode: "insensitive" } },
            { originalText: { contains: input.query, mode: "insensitive" } },
            { rewrittenText: { contains: input.query, mode: "insensitive" } },
            { id: { in: phraseCardIds } },
          ],
        } : {}),
      },
      select: {
        id: true,
        topic: true,
        originalText: true,
        rewrittenText: true,
        createdAt: true,
        segments: { orderBy: { ordinal: "asc" }, select: { id: true, text: true } },
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    const occurrences = matchingPhraseIds.length && cards.length
      ? await this.prisma.phraseOccurrence.findMany({
          where: {
            userId: input.userId,
            cardId: { in: cards.map((card) => card.id) },
            phraseId: { in: matchingPhraseIds },
          },
          select: {
            phraseId: true,
            cardId: true,
            sourceField: true,
            segmentId: true,
            startUtf16: true,
            endUtf16: true,
            surfaceText: true,
          },
          orderBy: [{ cardCreatedAt: "desc" }, { startUtf16: "asc" }],
        })
      : [];
    const occurrencesByCard = new Map<string, typeof occurrences>();
    for (const occurrence of occurrences) {
      const list = occurrencesByCard.get(occurrence.cardId) ?? [];
      list.push(occurrence);
      occurrencesByCard.set(occurrence.cardId, list);
    }
    return cards.map((card) => ({
      recordId: cardRecordId("card", card.id),
      topic: card.topic,
      originalText: card.originalText ?? "",
      rewrittenText: card.rewrittenText ?? "",
      createdAt: card.createdAt,
      reason: "search",
      matches: buildLexicalMatches({
        query: input.query,
        topic: card.topic,
        originalText: card.originalText ?? "",
        rewrittenText: card.rewrittenText ?? "",
        segments: card.segments,
        occurrences: occurrencesByCard.get(card.id) ?? [],
      }),
    }));
  }

  async semanticSearchCandidates(input: {
    userId: string;
    embedding: number[];
    modelVersion: string;
    collectionId?: string | null;
    timeRange?: "recent" | "this_year" | "last_year" | "earlier";
    limit: number;
  }): Promise<RecallCandidate[]> {
    const now = new Date();
    const thisYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const lastYear = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    const recent = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000);
    const createdAfter = input.timeRange === "recent" ? recent
      : input.timeRange === "this_year" ? thisYear
        : input.timeRange === "last_year" ? lastYear
          : null;
    const createdBefore = input.timeRange === "last_year" ? thisYear
      : input.timeRange === "earlier" ? lastYear
        : null;
    const collectionMode = input.collectionId === undefined
      ? "all"
      : input.collectionId === null
        ? "unclassified"
        : "collection";
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      id: string;
      topic: string | null;
      originalText: string | null;
      rewrittenText: string | null;
      createdAt: Date;
      score: number;
    }>>(
      `SELECT card."id",
              card."topic",
              card."originalText",
              card."rewrittenText",
              card."createdAt",
              (1 - (embedding."embedding" <=> $2::vector))::double precision AS "score"
         FROM "card_embeddings" AS embedding
         JOIN "cards" AS card
           ON card."id" = embedding."cardId"
          AND card."userId" = embedding."userId"
        WHERE embedding."userId" = $1
          AND embedding."modelVersion" = $3
          AND card."status" = 'completed'
          AND card."deletedAt" IS NULL
          AND card."isSample" = false
          AND (
            $4 = 'all'
            OR ($4 = 'unclassified' AND card."collectionId" IS NULL)
            OR ($4 = 'collection' AND card."collectionId" = $5)
          )
          AND ($6::timestamptz IS NULL OR card."createdAt" >= $6)
          AND ($7::timestamptz IS NULL OR card."createdAt" < $7)
        ORDER BY embedding."embedding" <=> $2::vector ASC,
                 card."id" ASC
        LIMIT $8`,
      input.userId,
      vectorLiteral(input.embedding),
      input.modelVersion,
      collectionMode,
      typeof input.collectionId === "string" ? input.collectionId : null,
      createdAfter,
      createdBefore,
      input.limit,
    );
    return rows.map((row) => ({
      recordId: cardRecordId("card", row.id),
      topic: row.topic,
      originalText: row.originalText ?? "",
      rewrittenText: row.rewrittenText ?? "",
      createdAt: row.createdAt,
      reason: "semantic_search",
      semanticScore: Number(row.score),
    }));
  }

  async createSession(userId: string, seedRecordId: string, launchMode: string, launchContext: unknown): Promise<string> {
    const ref = parseCardRecordId(seedRecordId);
    if (!ref || ref.source !== "card") throw recallError("RECALL_SEED_INVALID");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const seed = await tx.card.findFirst({
            where: { id: ref.sourceId, userId, status: "completed", deletedAt: null },
            select: { id: true },
          });
          if (!seed) throw recallError("RECALL_SEED_NOT_FOUND");
          await tx.recallSession.updateMany({
            where: { userId, status: "active" },
            data: { status: "abandoned", completedAt: new Date() },
          });
          const session = await tx.recallSession.create({
            data: {
              userId,
              seedCardId: ref.sourceId,
              launchMode,
              launchContext: jsonValue(launchContext),
              nodes: { create: { cardId: ref.sourceId, state: "current", ordinal: 0, openedAt: new Date() } },
            },
          });
          return session.id;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (attempt === 2 || !isRecallWriteConflict(error)) throw error;
      }
    }
    throw recallError("RECALL_SESSION_CONFLICT");
  }

  async getSession(userId: string, sessionId: string): Promise<ReturnType<typeof mapSession> | null> {
    const session = await this.prisma.recallSession.findFirst({
      where: { id: sessionId, userId },
      include: { nodes: { orderBy: { ordinal: "asc" } }, edges: { orderBy: { createdAt: "asc" } } },
    });
    return session ? mapSession(session) : null;
  }

  async getActiveSession(userId: string): Promise<ReturnType<typeof mapSession> | null> {
    const session = await this.prisma.recallSession.findFirst({
      where: { userId, status: "active" },
      include: { nodes: { orderBy: { ordinal: "asc" } }, edges: { orderBy: { createdAt: "asc" } } },
    });
    return session ? mapSession(session) : null;
  }

  async nodeRecordId(userId: string, sessionId: string, nodeId: string): Promise<string | null> {
    const node = await this.prisma.recallSessionNode.findFirst({
      where: { id: nodeId, sessionId, session: { userId, status: "active" } },
    });
    return node ? cardRecordId("card", node.cardId) : null;
  }

  async persistExpansion(input: {
    userId: string;
    sessionId: string;
    fromNodeId: string;
    relations: RecallRelationInput[];
    nodeLimit: number;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.recallSession.findFirst({
        where: { id: input.sessionId, userId: input.userId, status: "active" },
        include: { nodes: true },
      });
      if (!session || !session.nodes.some((node) => node.id === input.fromNodeId)) throw recallError("RECALL_SESSION_NOT_FOUND");
      const byRecord = new Map(session.nodes.map((node) => [`card:${node.cardId}`, node]));
      let nextOrdinal = session.nodes.reduce((max, node) => Math.max(max, node.ordinal), -1) + 1;
      for (const relation of input.relations) {
        const ref = parseCardRecordId(relation.recordId);
        if (!ref || ref.source !== "card") continue;
        const key = `${ref.source}:${ref.sourceId}`;
        let target = byRecord.get(key);
        if (!target) {
          if (byRecord.size >= input.nodeLimit) continue;
          const accessible = await tx.card.count({ where: { id: ref.sourceId, userId: input.userId, status: "completed", deletedAt: null } });
          if (!accessible) continue;
          target = await tx.recallSessionNode.create({
            data: { sessionId: session.id, cardId: ref.sourceId, ordinal: nextOrdinal++ },
          });
          byRecord.set(key, target);
        }
        for (const reason of relation.reasons) {
          const directed = reason.type === "progress";
          const endpoints = directed
            ? { fromNodeId: target.id, toNodeId: input.fromNodeId }
            : canonicalEndpoints(input.fromNodeId, target.id);
          if (endpoints.fromNodeId === endpoints.toNodeId) continue;
          const relationKey = reason.type === "topic" ? "topic" : `${reason.type}:${reason.phraseId ?? "unknown"}`;
          await tx.recallSessionEdge.upsert({
            where: {
              sessionId_fromNodeId_toNodeId_relationKey: {
                sessionId: session.id,
                fromNodeId: endpoints.fromNodeId,
                toNodeId: endpoints.toNodeId,
                relationKey,
              },
            },
            create: {
              sessionId: session.id,
              fromNodeId: endpoints.fromNodeId,
              toNodeId: endpoints.toNodeId,
              relationKey,
              relationType: reason.type,
              phraseId: reason.phraseId,
              reasons: jsonValue([reason]),
              isDirected: directed,
            },
            update: { reasons: jsonValue([reason]) },
          });
        }
      }
      await tx.recallSession.update({ where: { id: session.id }, data: { lastOpenedAt: new Date() } });
    });
  }

  async updateNode(userId: string, sessionId: string, nodeId: string, state: "unvisited" | "current" | "completed"): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.recallSession.findFirst({ where: { id: sessionId, userId, status: "active" } });
      if (!session) return false;
      if (state === "current") await tx.recallSessionNode.updateMany({ where: { sessionId, state: "current" }, data: { state: "unvisited" } });
      const changed = await tx.recallSessionNode.updateMany({
        where: { id: nodeId, sessionId },
        data: {
          state,
          openedAt: state === "current" ? new Date() : undefined,
          completedAt: state === "completed" ? new Date() : undefined,
        },
      });
      await tx.recallSession.update({ where: { id: sessionId }, data: { lastOpenedAt: new Date() } });
      return changed.count === 1;
    });
  }

  async finish(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.prisma.recallSession.updateMany({
      where: { id: sessionId, userId, status: "active" },
      data: { status: "completed", completedAt: new Date() },
    });
    return result.count === 1;
  }
}

function mapSession(session: any) {
  return {
    id: session.id,
    seedRecordId: cardRecordId("card", session.seedCardId),
    launchMode: session.launchMode,
    launchContext: session.launchContext,
    status: session.status,
    lastOpenedAt: session.lastOpenedAt,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    nodes: session.nodes.map((node: any) => ({
      id: node.id,
      recordId: cardRecordId("card", node.cardId),
      state: node.state,
      ordinal: node.ordinal,
      openedAt: node.openedAt,
      completedAt: node.completedAt,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    })),
    edges: session.edges.map((edge: any) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      relationType: edge.relationType,
      phraseId: edge.phraseId,
      reasons: edge.reasons,
      isDirected: edge.isDirected,
      createdAt: edge.createdAt,
    })),
  };
}

function canonicalEndpoints(left: string, right: string): { fromNodeId: string; toNodeId: string } {
  return left < right ? { fromNodeId: left, toNodeId: right } : { fromNodeId: right, toNodeId: left };
}

function stableShuffle<T>(items: T[]): T[] {
  return items.map((item, index) => ({ item, key: Math.sin(Date.now() + index * 9_973) }))
    .sort((left, right) => left.key - right.key)
    .map(({ item }) => item);
}

function jsonValue(value: unknown): any {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function vectorLiteral(values: number[]): string {
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw recallError("RECALL_SEARCH_EMBEDDING_INVALID");
  }
  return `[${values.join(",")}]`;
}

export function buildLexicalMatches(input: {
  query: string;
  topic: string | null;
  originalText: string;
  rewrittenText: string;
  segments: Array<{ id: string; text: string }>;
  occurrences: Array<{
    phraseId: string;
    sourceField: string;
    segmentId: string | null;
    startUtf16: number;
    endUtf16: number;
    surfaceText: string;
  }>;
}): LexicalSearchMatch[] {
  const matches: LexicalSearchMatch[] = [];
  const append = (match: LexicalSearchMatch) => {
    const key = `${match.field}:${match.phraseId ?? ""}:${match.startUtf16 ?? ""}:${match.surfaceText.toLocaleLowerCase()}`;
    if (!matches.some((item) => (
      `${item.field}:${item.phraseId ?? ""}:${item.startUtf16 ?? ""}:${item.surfaceText.toLocaleLowerCase()}` === key
    ))) matches.push(match);
  };
  const topicMatch = findDirectMatch(input.topic ?? "", input.query);
  if (topicMatch) append({
    field: "topic",
    matchType: "exact",
    sentence: input.topic ?? "",
    surfaceText: topicMatch.surfaceText,
    startUtf16: topicMatch.startUtf16,
    endUtf16: topicMatch.endUtf16,
  });
  const originalMatch = findDirectMatch(input.originalText, input.query);
  if (originalMatch) append({
    field: "original",
    matchType: "exact",
    sentence: sentenceAround(input.originalText, originalMatch.startUtf16, originalMatch.endUtf16),
    ...originalMatch,
  });
  const rewrittenMatch = findDirectMatch(input.rewrittenText, input.query);
  if (rewrittenMatch) {
    const segment = input.segments.find((item) => containsInsensitive(item.text, input.query));
    append({
      field: "ai_expression",
      matchType: "exact",
      sentence: segment?.text ?? sentenceAround(input.rewrittenText, rewrittenMatch.startUtf16, rewrittenMatch.endUtf16),
      ...rewrittenMatch,
    });
  }
  const segmentById = new Map(input.segments.map((segment) => [segment.id, segment.text]));
  for (const occurrence of input.occurrences) {
    const field = occurrence.sourceField === "original" ? "original" as const : "ai_expression" as const;
    const sourceText = field === "original" ? input.originalText : input.rewrittenText;
    const sentence = occurrence.segmentId
      ? segmentById.get(occurrence.segmentId) ?? sentenceAround(sourceText, occurrence.startUtf16, occurrence.endUtf16)
      : sentenceAround(sourceText, occurrence.startUtf16, occurrence.endUtf16);
    append({
      field,
      matchType: containsInsensitive(occurrence.surfaceText, input.query) ? "exact" : "variant",
      sentence,
      surfaceText: occurrence.surfaceText,
      startUtf16: occurrence.startUtf16,
      endUtf16: occurrence.endUtf16,
      phraseId: occurrence.phraseId,
    });
  }
  return matches.slice(0, 5);
}

function findDirectMatch(text: string, query: string): {
  surfaceText: string;
  startUtf16: number;
  endUtf16: number;
} | null {
  if (!text || !query) return null;
  const startUtf16 = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (startUtf16 < 0) return null;
  const endUtf16 = startUtf16 + query.length;
  return { surfaceText: text.slice(startUtf16, endUtf16), startUtf16, endUtf16 };
}

function containsInsensitive(text: string, query: string): boolean {
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function sentenceAround(text: string, startUtf16: number, endUtf16: number): string {
  if (!text) return "";
  const boundaries = /[。！？.!?\n]/u;
  let start = Math.max(0, Math.min(startUtf16, text.length));
  let end = Math.max(start, Math.min(endUtf16, text.length));
  while (start > 0 && !boundaries.test(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && !boundaries.test(text[end] ?? "")) end += 1;
  if (end < text.length) end += 1;
  return text.slice(start, end).trim();
}

function recallError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function isRecallWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === "P2002" || code === "P2034";
}
