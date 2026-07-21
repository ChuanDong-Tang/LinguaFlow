/** PrismaMessageRepository：MessageRepository 的 Prisma 实现。 */

import type {
  CreateMessageInput,
  ListByConversationDayPageInput,
  ListByConversationRangeInput,
  ListDateKeysByUserContactRangeInput,
  ListPracticeDateKeysByUserRangeInput,
  MessageEntity,
  MessageRepository,
  PracticeDayStatsEntity,
  UpdateMessageClozeInput,
  UpdateMessageClozeResult,
  UpdateMessageStatusInput,
} from "@lf/core/ports/repository/MessageRepository.js";
import { dateKeyRangeInBusinessTimeZone, formatDateKeyInTimeZone } from "../../services/time/businessClock.js";

type PrismaMessageClient = {
  message: {
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
  };
};

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly prisma: PrismaMessageClient) {}

  async create(input: CreateMessageInput): Promise<MessageEntity> {
    const created = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        userId: input.userId,
        role: input.role,
        status: input.status ?? "pending",
        content: input.content,
        inputChars: input.inputChars ?? 0,
        outputChars: input.outputChars ?? 0,
        clientId: input.clientId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        clozeState: input.clozeState ?? undefined,
        clozeVersion: input.clozeVersion ?? undefined,
        clozePracticeDiscardedAt: input.clozePracticeDiscardedAt ?? undefined,
        conversationDateKey: input.conversationDateKey ?? null,
        languageCode: input.languageCode ?? null,
        createdAt: input.createdAt ?? undefined,
      },
    });

    return this.toEntity(created);
  }

  async updateStatus(input: UpdateMessageStatusInput): Promise<MessageEntity> {
    const updated = await this.prisma.message.update({
      where: { id: input.messageId },
      data: {
        status: input.status,
        outputChars: input.outputChars,
      },
    });

    return this.toEntity(updated);
  }

  async updateClozeState(input: UpdateMessageClozeInput): Promise<UpdateMessageClozeResult> {
    const rows = await (this.prisma.message as any).updateMany({
      where: {
        id: input.messageId,
        clozeVersion: input.baseVersion,
      },
      data: {
        clozeState: input.clozeState,
        clozeVersion: { increment: 1 },
      },
    });

    const row = await this.prisma.message.findUnique({
      where: { id: input.messageId },
    });
    if (!row) {
      throw new Error("Message not found after cloze update");
    }

    return {
      ok: Number(rows?.count ?? 0) === 1,
      message: this.toEntity(row),
    };
  }

  async discardClozePractice(messageId: string): Promise<MessageEntity> {
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        clozePracticeDiscardedAt: new Date(),
      },
    });

    return this.toEntity(updated);
  }

  async findAssistantBySourceMessageId(sourceMessageId: string): Promise<MessageEntity | null> {
    const row = await this.prisma.message.findFirst({
      where: {
        sourceMessageId,
        role: "assistant",
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return row ? this.toEntity(row) : null;
  }

  async findByUserConversationClientId(
    userId: string,
    conversationId: string,
    clientId: string
  ): Promise<MessageEntity | null> {
    const row = await this.prisma.message.findFirst({
      where: {
        userId,
        conversationId,
        clientId,
      },
    });
    return row ? this.toEntity(row) : null;
  }

  async listByConversation(conversationId: string, limit: number): Promise<MessageEntity[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
    });

    return rows.map((row) => this.toEntity(row));
  }

  async listByUserAndDay(userId: string, dayStart: Date, dayEnd: Date): Promise<MessageEntity[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        userId,
        createdAt: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    return rows.map((row) => this.toEntity(row));
  }

  async listSuccessfulByUserBefore(userId: string, before: Date, limit: number): Promise<MessageEntity[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        userId,
        status: "success",
        createdAt: { lt: before },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map((row) => this.toEntity(row));
  }

  async listByConversationRange(input: ListByConversationRangeInput): Promise<MessageEntity[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: input.conversationId,
        OR: [
          {
            conversationDateKey: {
              gte: input.fromDateKey,
              lte: input.toDateKey,
            },
          },
          {
            conversationDateKey: null,
            createdAt: {
              gte: input.from,
              lte: input.to,
            },
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }],
      take: input.limit ?? 500,
    });

    return rows.map((row) => this.toEntity(row));
  }

  async listByConversationDayPage(input: ListByConversationDayPageInput): Promise<MessageEntity[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: input.conversationId,
        status: "success",
        OR: [
          { conversationDateKey: input.dateKey },
          {
            conversationDateKey: null,
            createdAt: {
              gte: input.from,
              lte: input.to,
            },
          },
        ],
        ...(input.beforeCreatedAt
          ? {
              createdAt: {
                lt: input.beforeCreatedAt,
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });

    return rows.map((row) => this.toEntity(row));
  }

  async listDateKeysByUserContactRange(input: ListDateKeysByUserContactRangeInput): Promise<string[]> {
    const from = dateKeyRangeInBusinessTimeZone(input.fromDateKey).start;
    const to = dateKeyRangeInBusinessTimeZone(input.toDateKey).end;
    const rows = await this.prisma.message.findMany({
      where: {
        userId: input.userId,
        status: { not: "failed" },
        OR: [
          {
            conversationDateKey: {
              gte: input.fromDateKey,
              lte: input.toDateKey,
            },
          },
          {
            conversationDateKey: null,
            createdAt: {
              gte: from,
              lte: to,
            },
          },
        ],
        conversation: {
          contactId: input.contactId,
          archivedAt: null,
        },
      },
      select: {
        createdAt: true,
        conversationDateKey: true,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const keys = new Set<string>();
    for (const row of rows) {
      keys.add(row.conversationDateKey ?? formatDateKeyInTimeZone(row.createdAt));
    }
    return Array.from(keys);
  }

  async listPracticeDateKeysByUserRange(input: ListPracticeDateKeysByUserRangeInput): Promise<string[]> {
    const from = dateKeyRangeInBusinessTimeZone(input.fromDateKey).start;
    const to = dateKeyRangeInBusinessTimeZone(input.toDateKey).end;
    // 练习日历只需要知道哪些天有可练习的 assistant 消息；
    // 先查 dateKey，前端再按这些天拉消息，避免盲扫整个月每天。
    const rows = await this.prisma.message.findMany({
      where: {
        userId: input.userId,
        role: "assistant",
        status: "success",
        clozeState: { not: null },
        clozePracticeDiscardedAt: null,
        OR: [
          {
            conversationDateKey: {
              gte: input.fromDateKey,
              lte: input.toDateKey,
            },
          },
          {
            conversationDateKey: null,
            createdAt: {
              gte: from,
              lte: to,
            },
          },
        ],
        conversation: {
          contactId: { in: input.contactIds },
          archivedAt: null,
        },
      },
      select: {
        createdAt: true,
        conversationDateKey: true,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const keys = new Set<string>();
    for (const row of rows) {
      keys.add(row.conversationDateKey ?? formatDateKeyInTimeZone(row.createdAt));
    }
    return Array.from(keys);
  }

  async listPracticeDayStatsByUserRange(input: ListPracticeDateKeysByUserRangeInput): Promise<PracticeDayStatsEntity[]> {
    const from = dateKeyRangeInBusinessTimeZone(input.fromDateKey).start;
    const to = dateKeyRangeInBusinessTimeZone(input.toDateKey).end;
    const rows = await this.prisma.message.findMany({
      where: {
        userId: input.userId,
        role: "assistant",
        status: "success",
        clozeState: { not: null },
        clozePracticeDiscardedAt: null,
        OR: [
          {
            conversationDateKey: {
              gte: input.fromDateKey,
              lte: input.toDateKey,
            },
          },
          {
            conversationDateKey: null,
            createdAt: {
              gte: from,
              lte: to,
            },
          },
        ],
        conversation: {
          contactId: { in: input.contactIds },
          archivedAt: null,
        },
      },
      select: {
        createdAt: true,
        conversationDateKey: true,
        clozeState: true,
      },
      orderBy: [{ createdAt: "asc" }],
    });

    const stats = new Map<string, PracticeDayStatsEntity>();
    for (const row of rows) {
      const clozeState = normalizeClozeState(row.clozeState);
      if (!clozeState) continue;
      const dateKey = row.conversationDateKey ?? formatDateKeyInTimeZone(row.createdAt);
      const current = stats.get(dateKey) ?? { dateKey, total: 0, correct: 0 };
      const messageStats = summarizeClozeState(clozeState);
      current.total += messageStats.total;
      current.correct += messageStats.correct;
      if (current.total > 0) stats.set(dateKey, current);
    }

    return Array.from(stats.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  }

  async findById(messageId: string): Promise<MessageEntity | null> {
    const row = await this.prisma.message.findUnique({
      where: {
        id: messageId
      },
    });   
    return row ? this.toEntity(row) : null;
  }

  private toEntity(record: {
    id: string;
    conversationId: string;
    userId: string;
    role: "user" | "assistant";
    status: "pending" | "success" | "failed";
    content: string;
    inputChars: number;
    outputChars: number;
    sourceMessageId: string | null;
    clientId?: string | null;
    clozeState?: unknown;
    clozeVersion?: number;
    clozePracticeDiscardedAt?: Date | null;
    conversationDateKey?: string | null;
    languageCode?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): MessageEntity {
    return {
      id: record.id,
      conversationId: record.conversationId,
      userId: record.userId,
      role: record.role,
      status: record.status,
      content: record.content,
      inputChars: record.inputChars,
      outputChars: record.outputChars,
      clientId: record.clientId ?? null,
      sourceMessageId: record.sourceMessageId,
      clozeState: normalizeClozeState(record.clozeState),
      clozeVersion: Number.isFinite(record.clozeVersion) ? Number(record.clozeVersion) : 0,
      clozePracticeDiscardedAt: record.clozePracticeDiscardedAt ?? null,
      conversationDateKey: record.conversationDateKey ?? null,
      languageCode: record.languageCode ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

function normalizeClozeState(value: unknown): MessageEntity["clozeState"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as { groups?: unknown; correctTokenIndexes?: unknown };
  const groups = Array.isArray(raw.groups)
    ? raw.groups
      .filter((group): group is { tokenIndexes?: unknown; blankTokenIndexes?: unknown } => !!group && typeof group === "object")
      .map((group) => ({
        tokenIndexes: Array.isArray(group.tokenIndexes) ? group.tokenIndexes.filter(Number.isInteger).map(Number) : [],
        blankTokenIndexes: Array.isArray(group.blankTokenIndexes) ? group.blankTokenIndexes.filter(Number.isInteger).map(Number) : [],
      }))
    : [];
  const correctTokenIndexes = Array.isArray(raw.correctTokenIndexes)
    ? raw.correctTokenIndexes.filter(Number.isInteger).map(Number)
    : [];
  return { groups, correctTokenIndexes };
}

function summarizeClozeState(state: NonNullable<MessageEntity["clozeState"]>): { total: number; correct: number } {
  const blankIndexes = new Set<number>();
  state.groups.forEach((group) => {
    group.blankTokenIndexes.forEach((index) => blankIndexes.add(index));
  });
  let correct = 0;
  state.correctTokenIndexes.forEach((index) => {
    if (blankIndexes.has(index)) correct += 1;
  });
  return {
    total: blankIndexes.size,
    correct,
  };
}
