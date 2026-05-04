/** PrismaConversationRepository：ConversationRepository 的 Prisma 实现。 */

import type {
  ConversationEntity,
  ConversationRepository,
  CreateConversationInput,
} from "@lf/core/ports/repository/ConversationRepository.js";

type PrismaConversationClient = {
  conversation: {
    create: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
  };
};

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prisma: PrismaConversationClient) {}

  async create(input: CreateConversationInput): Promise<ConversationEntity> {
    //console.log("creating conversation for userId=", input.userId);
    const created = await this.prisma.conversation.create({
      data: {
        userId: input.userId,
        contactId: input.contactId,
        dateKey: input.dateKey,
        title: input.title ?? null,
      },
    });

    return this.toEntity(created);
  }

  async findById(conversationId: string): Promise<ConversationEntity | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    return row ? this.toEntity(row) : null;
  }

  async findByUserContactDate(
    userId: string,
    contactId: string,
    dateKey: string
  ): Promise<ConversationEntity | null> {
    const row = await this.prisma.conversation.findUnique({
      where: {
        userId_contactId_dateKey: {
          userId,
          contactId,
          dateKey,
        },
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async listByUser(userId: string, limit: number): Promise<ConversationEntity[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
    });

    return rows.map((row) => this.toEntity(row));
  }

  async touch(conversationId: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
      },
    });
  }

  private toEntity(record: {
    id: string;
    userId: string;
    contactId: string;
    dateKey: string | null;
    title: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ConversationEntity {
    return {
      id: record.id,
      userId: record.userId,
      contactId: record.contactId,
      dateKey: record.dateKey ?? "",
      title: record.title,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
