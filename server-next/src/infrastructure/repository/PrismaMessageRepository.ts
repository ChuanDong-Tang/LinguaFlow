/** PrismaMessageRepository：MessageRepository 的 Prisma 实现。 */

import type { PrismaClient } from "@prisma/client";
import type {
  CreateMessageInput,
  ListByConversationRangeInput,
  MessageEntity,
  MessageRepository,
  UpdateMessageStatusInput,
} from "@lf/core/ports/repository/MessageRepository.js";

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
        createdAt: {
          gte: input.from,
          lte: input.to,
        },
      },
      orderBy: [{ createdAt: "asc" }],
      take: input.limit ?? 500,
    });

    return rows.map((row) => this.toEntity(row));
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
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
