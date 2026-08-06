import type { PrismaClient } from "@prisma/client";
import { dateKeyRangeInBusinessTimeZone, formatDateKeyInTimeZone } from "../../services/time/businessClock.js";

export type QuickNoteView = {
  id: string;
  clientId: string;
  legacyMessageId: string | null;
  dateKey: string;
  originalText: string;
  expressionText: string | null;
  translationText: string | null;
  replyText: string | null;
  expressionStatus: string;
  translationStatus: string;
  replyStatus: string;
  convertedCardId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyMessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sourceMessageId: string | null;
  conversationDateKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  contactCode: string;
};

const quickNoteSelect = {
  id: true,
  clientId: true,
  legacyMessageId: true,
  dateKey: true,
  originalText: true,
  expressionText: true,
  translationText: true,
  replyText: true,
  expressionStatus: true,
  translationStatus: true,
  replyStatus: true,
  convertedCardId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaQuickNoteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(userId: string, input: { clientId: string; dateKey: string; originalText: string; legacyMessageId?: string | null; expressionText?: string | null; translationText?: string | null; replyText?: string | null }): Promise<QuickNoteView> {
    return this.prisma.quickNote.upsert({
      where: { userId_clientId: { userId, clientId: input.clientId } },
      create: { userId, ...input },
      update: {},
      select: quickNoteSelect,
    });
  }

  materializeLegacy(userId: string, input: {
    legacyMessageId: string;
    dateKey: string;
    originalText: string;
    expressionText: string | null;
    translationText: string | null;
    replyText: string | null;
    createdAt: Date;
  }): Promise<QuickNoteView> {
    return this.prisma.quickNote.upsert({
      where: { userId_legacyMessageId: { userId, legacyMessageId: input.legacyMessageId } },
      create: {
        userId,
        clientId: `legacy:${input.legacyMessageId}`,
        ...input,
        expressionStatus: input.expressionText ? "ready" : "idle",
        translationStatus: input.translationText ? "ready" : "idle",
        replyStatus: input.replyText ? "ready" : "idle",
      },
      update: {},
      select: quickNoteSelect,
    });
  }

  listDay(userId: string, dateKey: string): Promise<QuickNoteView[]> {
    return this.prisma.quickNote.findMany({
      where: { userId, dateKey },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: quickNoteSelect,
    });
  }

  find(userId: string, noteId: string): Promise<QuickNoteView | null> {
    return this.prisma.quickNote.findFirst({ where: { id: noteId, userId }, select: quickNoteSelect });
  }

  async listDateKeys(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]> {
    const rows = await this.prisma.quickNote.findMany({
      where: { userId, dateKey: { gte: fromDateKey, lte: toDateKey } },
      distinct: ["dateKey"],
      orderBy: { dateKey: "asc" },
      select: { dateKey: true },
    });
    return rows.map((row) => row.dateKey);
  }

  async listLegacyDay(userId: string, dateKey: string): Promise<LegacyMessageRow[]> {
    const { start, end } = dateKeyRangeInBusinessTimeZone(dateKey);
    const rows = await this.prisma.message.findMany({
      where: {
        userId,
        status: "success",
        OR: [{ conversationDateKey: dateKey }, { conversationDateKey: null, createdAt: { gte: start, lte: end } }],
        conversation: { archivedAt: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1000,
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        sourceMessageId: true,
        conversationDateKey: true,
        createdAt: true,
        updatedAt: true,
        conversation: { select: { contact: { select: { code: true } } } },
      },
    });
    return rows.map((row) => ({ ...row, contactCode: row.conversation.contact.code }));
  }

  async listLegacyDateKeys(userId: string, fromDateKey: string, toDateKey: string): Promise<string[]> {
    const from = dateKeyRangeInBusinessTimeZone(fromDateKey).start;
    const to = dateKeyRangeInBusinessTimeZone(toDateKey).end;
    const rows = await this.prisma.message.findMany({
      where: {
        userId,
        status: "success",
        OR: [
          { conversationDateKey: { gte: fromDateKey, lte: toDateKey } },
          { conversationDateKey: null, createdAt: { gte: from, lte: to } },
        ],
        conversation: { archivedAt: null },
      },
      orderBy: { createdAt: "asc" },
      select: { conversationDateKey: true, createdAt: true },
    });
    return Array.from(new Set(rows.map((row) => row.conversationDateKey ?? formatDateKeyInTimeZone(row.createdAt)))).sort();
  }

  async findLegacyPair(userId: string, messageId: string): Promise<{ user: LegacyMessageRow | null; assistant: LegacyMessageRow | null } | null> {
    const select = {
      id: true, conversationId: true, role: true, content: true, sourceMessageId: true,
      conversationDateKey: true, createdAt: true, updatedAt: true,
      conversation: { select: { contact: { select: { code: true } } } },
    } as const;
    const anchor = await this.prisma.message.findFirst({ where: { id: messageId, userId, status: "success" }, select });
    if (!anchor) return null;
    const map = (row: typeof anchor): LegacyMessageRow => ({ ...row!, contactCode: row!.conversation.contact.code });
    if (anchor.role === "user") {
      const sourced = await this.prisma.message.findFirst({ where: { userId, role: "assistant", status: "success", sourceMessageId: anchor.id }, orderBy: { createdAt: "asc" }, select });
      const assistant = sourced ?? await this.prisma.message.findFirst({
        where: { userId, role: "assistant", status: "success", conversationId: anchor.conversationId, createdAt: { gt: anchor.createdAt } },
        orderBy: { createdAt: "asc" }, select,
      });
      return { user: map(anchor), assistant: assistant ? map(assistant) : null };
    }
    const user = anchor.sourceMessageId
      ? await this.prisma.message.findFirst({ where: { id: anchor.sourceMessageId, userId, role: "user", status: "success" }, select })
      : null;
    return { user: user ? map(user) : null, assistant: map(anchor) };
  }

  async updateExpression(userId: string, noteId: string, expressionText: string | null): Promise<QuickNoteView | null> {
    const changed = await this.prisma.quickNote.updateMany({
      where: { id: noteId, userId },
      data: { expressionText, expressionStatus: expressionText ? "ready" : "idle" },
    });
    if (changed.count !== 1) return null;
    return this.prisma.quickNote.findUnique({ where: { id: noteId }, select: quickNoteSelect });
  }

  async updateContent(userId: string, noteId: string, data: {
    originalText?: string;
    expressionText?: string | null;
    translationText?: string | null;
    replyText?: string | null;
  }): Promise<QuickNoteView | null> {
    const changed = await this.prisma.quickNote.updateMany({
      where: { id: noteId, userId },
      data: {
        ...data,
        ...(Object.prototype.hasOwnProperty.call(data, "expressionText")
          ? { expressionStatus: data.expressionText ? "ready" : "idle" }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, "translationText")
          ? { translationStatus: data.translationText ? "ready" : "idle" }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(data, "replyText")
          ? { replyStatus: data.replyText ? "ready" : "idle" }
          : {}),
      },
    });
    if (changed.count !== 1) return null;
    return this.prisma.quickNote.findUnique({ where: { id: noteId }, select: quickNoteSelect });
  }

  async updateGenerationStatus(
    userId: string,
    noteId: string,
    target: "expression" | "translation" | "reply",
    status: "idle" | "added" | "generating" | "ready" | "failed",
  ): Promise<QuickNoteView | null> {
    const statusField = target === "expression" ? "expressionStatus" : target === "translation" ? "translationStatus" : "replyStatus";
    const changed = await this.prisma.quickNote.updateMany({ where: { id: noteId, userId }, data: { [statusField]: status } });
    if (changed.count !== 1) return null;
    return this.prisma.quickNote.findUnique({ where: { id: noteId }, select: quickNoteSelect });
  }

  async remove(userId: string, noteId: string): Promise<boolean> {
    const removed = await this.prisma.quickNote.deleteMany({ where: { id: noteId, userId } });
    return removed.count === 1;
  }
}
