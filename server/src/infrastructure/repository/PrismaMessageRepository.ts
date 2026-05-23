/** PrismaMessageRepository：MessageRepository 的 Prisma 实现。 */

import type {
  CreateMessageInput,
  ListByConversationDayPageInput,
  ListByConversationRangeInput,
  ListDateKeysByUserContactRangeInput,
  ListPracticeDateKeysByUserRangeInput,
  MessageEntity,
  MessageRepository,
  UpdateMessageClozeInput,
  UpdateMessageClozeResult,
  UpdateMessageStatusInput,
} from "@lf/core/ports/repository/MessageRepository.js";

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
        sourceMessageId: input.sourceMessageId ?? null,
        conversationDateKey: input.conversationDateKey ?? null,
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
        status: { not: "failed" },
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
    const from = new Date(`${input.fromDateKey}T00:00:00+08:00`);
    const to = new Date(`${input.toDateKey}T23:59:59.999+08:00`);
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
      keys.add(row.conversationDateKey ?? formatDateKey(row.createdAt));
    }
    return Array.from(keys);
  }

  async listPracticeDateKeysByUserRange(input: ListPracticeDateKeysByUserRangeInput): Promise<string[]> {
    const from = new Date(`${input.fromDateKey}T00:00:00+08:00`);
    const to = new Date(`${input.toDateKey}T23:59:59.999+08:00`);
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
      keys.add(row.conversationDateKey ?? formatDateKey(row.createdAt));
    }
    return Array.from(keys);
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
    clozeState?: unknown;
    clozeVersion?: number;
    clozePracticeDiscardedAt?: Date | null;
    conversationDateKey?: string | null;
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
      sourceMessageId: record.sourceMessageId,
      clozeState: normalizeClozeState(record.clozeState),
      clozeVersion: Number.isFinite(record.clozeVersion) ? Number(record.clozeVersion) : 0,
      clozePracticeDiscardedAt: record.clozePracticeDiscardedAt ?? null,
      conversationDateKey: record.conversationDateKey ?? null,
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

function formatDateKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}
