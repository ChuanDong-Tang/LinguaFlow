import type { PrismaClient } from "@prisma/client";
import { cardRecordId, parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { PracticeStateRow } from "@lf/core/text/practiceStats.js";

export type OioAiStoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  blocks: unknown;
  trace: unknown;
  createdAt: Date;
};

export type OioAiCardSummary = {
  recordId: string;
  title: string;
  dateKey: string;
  preview: string;
  hasPhoto: boolean;
};

const PREVIEW_CHARS = 140;

function cardTitle(row: { title: string | null; topic: string | null; originalText: string | null }): string {
  return row.title?.trim() || row.topic?.trim() || (row.originalText ?? "").trim().slice(0, 24);
}

/** OIO AI storage (threads, messages) and the read-only queries behind its tools. */
export class PrismaOioAiRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createThread(userId: string, input: { title?: string | null; contextCardId?: string | null }): Promise<string> {
    const thread = await this.prisma.aiThread.create({ data: { userId, title: input.title ?? null, contextCardId: input.contextCardId ?? null } });
    return thread.id;
  }

  async findThread(userId: string, threadId: string) {
    return this.prisma.aiThread.findFirst({ where: { id: threadId, userId } });
  }

  async listThreads(userId: string, limit: number) {
    return this.prisma.aiThread.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, title: true, contextCardId: true, updatedAt: true } });
  }

  async listMessages(userId: string, threadId: string, limit: number): Promise<OioAiStoredMessage[]> {
    const rows = await this.prisma.aiMessage.findMany({ where: { threadId, userId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.reverse().map((row) => ({ id: row.id, role: row.role === "user" ? "user" : "assistant", text: row.text, blocks: row.blocks, trace: row.trace, createdAt: row.createdAt }));
  }

  async appendMessage(userId: string, threadId: string, input: { role: "user" | "assistant"; text: string; blocks?: unknown; trace?: unknown; requestId?: string; promptVersion?: string }): Promise<string> {
    const [message] = await this.prisma.$transaction([
      this.prisma.aiMessage.create({ data: {
        threadId, userId, role: input.role, text: input.text,
        blocks: (input.blocks ?? undefined) as never, trace: (input.trace ?? undefined) as never,
        requestId: input.requestId ?? null, promptVersion: input.promptVersion ?? null,
      } }),
      this.prisma.aiThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } }),
    ]);
    return message.id;
  }

  async setThreadTitle(userId: string, threadId: string, title: string): Promise<void> {
    await this.prisma.aiThread.updateMany({ where: { id: threadId, userId, title: null }, data: { title } });
  }

  /** Cards recorded in [from, to] (dateKey, inclusive), newest first. */
  async listCardsInRange(userId: string, input: { dateFrom?: string; dateTo?: string; hasPhoto?: boolean; limit: number }): Promise<OioAiCardSummary[]> {
    const rows = await this.prisma.card.findMany({
      where: {
        userId, status: "completed", deletedAt: null, isSample: false,
        ...(input.dateFrom || input.dateTo ? { dateKey: { ...(input.dateFrom ? { gte: input.dateFrom } : {}), ...(input.dateTo ? { lte: input.dateTo } : {}) } } : {}),
        ...(input.hasPhoto ? { images: { some: {} } } : {}),
      },
      orderBy: [{ recordedAt: "desc" }, { id: "asc" }],
      take: input.limit,
      select: { id: true, title: true, topic: true, originalText: true, rewrittenText: true, dateKey: true, _count: { select: { images: true } } },
    });
    return rows.map((row) => ({
      recordId: cardRecordId("card", row.id),
      title: cardTitle(row),
      dateKey: row.dateKey,
      preview: (row.rewrittenText?.trim() || row.originalText || "").slice(0, PREVIEW_CHARS),
      hasPhoto: row._count.images > 0,
    }));
  }

  /** Date keys and photo flags for cards found by search, to apply date / photo filters after ranking. */
  async cardFacts(userId: string, recordIds: string[]): Promise<Map<string, { dateKey: string; hasPhoto: boolean }>> {
    const ids = recordIds.flatMap((recordId) => { const ref = parseCardRecordId(recordId); return ref?.source === "card" ? [ref.sourceId] : []; });
    if (!ids.length) return new Map();
    const rows = await this.prisma.card.findMany({ where: { userId, id: { in: ids } }, select: { id: true, dateKey: true, _count: { select: { images: true } } } });
    return new Map(rows.map((row) => [cardRecordId("card", row.id), { dateKey: row.dateKey, hasPhoto: row._count.images > 0 }]));
  }

  async getCard(userId: string, recordId: string) {
    const ref = parseCardRecordId(recordId);
    if (ref?.source !== "card") return null;
    const row = await this.prisma.card.findFirst({
      where: { id: ref.sourceId, userId, deletedAt: null },
      select: {
        id: true, title: true, topic: true, originalText: true, rewrittenText: true, replyText: true, dateKey: true, recordedAt: true,
        _count: { select: { images: true } },
        contentPracticeStates: { select: { contentType: true, clozeState: true } },
      },
    });
    if (!row) return null;
    const primary = row.rewrittenText?.trim() ? "rewrite" : "original";
    const state = row.contentPracticeStates.find((item) => item.contentType === primary)?.clozeState;
    const blanks = state && typeof state === "object" && Array.isArray((state as { blanks?: unknown }).blanks) ? (state as { blanks: Array<Record<string, unknown>> }).blanks : [];
    return {
      recordId: cardRecordId("card", row.id),
      title: cardTitle(row),
      dateKey: row.dateKey,
      original: row.originalText ?? "",
      rewrite: row.rewrittenText ?? "",
      reply: row.replyText ?? "",
      hasPhoto: row._count.images > 0,
      blanks: blanks.map((blank) => ({ answer: blank.answer, lastResult: blank.lastResult ?? (blank.mastered ? "correct" : null), attempts: blank.attempts ?? 0 })),
    };
  }

  /** Practice states of the user's cards touched since `since` (bounded). */
  async practiceRows(userId: string, since: Date, limit = 400): Promise<PracticeStateRow[]> {
    const rows = await this.prisma.cardContentPracticeState.findMany({
      where: { userId, updatedAt: { gte: since }, card: { deletedAt: null, isSample: false } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { cardId: true, clozeState: true, updatedAt: true, card: { select: { title: true, topic: true, originalText: true } } },
    });
    return rows.map((row) => ({ cardId: cardRecordId("card", row.cardId), title: cardTitle(row.card), updatedAt: row.updatedAt, clozeState: row.clozeState }));
  }

  async previews(userId: string, recordIds: string[]): Promise<Map<string, OioAiCardSummary>> {
    const ids = recordIds.flatMap((recordId) => { const ref = parseCardRecordId(recordId); return ref?.source === "card" ? [ref.sourceId] : []; });
    if (!ids.length) return new Map();
    const rows = await this.prisma.card.findMany({
      where: { userId, id: { in: ids }, deletedAt: null },
      select: { id: true, title: true, topic: true, originalText: true, rewrittenText: true, dateKey: true, _count: { select: { images: true } } },
    });
    return new Map(rows.map((row) => [cardRecordId("card", row.id), {
      recordId: cardRecordId("card", row.id), title: cardTitle(row), dateKey: row.dateKey,
      preview: (row.rewrittenText?.trim() || row.originalText || "").slice(0, PREVIEW_CHARS), hasPhoto: row._count.images > 0,
    }]));
  }
}
