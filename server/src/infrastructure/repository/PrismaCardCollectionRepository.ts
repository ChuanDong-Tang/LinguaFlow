import type { PrismaClient } from "@prisma/client";

export interface CardCollectionView {
  id: string;
  name: string;
  cardCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaCardCollectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(userId: string): Promise<{ collections: CardCollectionView[]; unclassifiedCount: number }> {
    const [collections, unclassifiedCount] = await Promise.all([
      this.prisma.cardCollection.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        include: {
          _count: {
            select: { cards: { where: { status: "completed", deletedAt: null } } },
          },
        },
      }),
      this.prisma.card.count({ where: { userId, collectionId: null, status: "completed", deletedAt: null } }),
    ]);
    return {
      collections: collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        cardCount: collection._count.cards,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
      })),
      unclassifiedCount,
    };
  }

  async create(userId: string, name: string, normalizedName: string): Promise<CardCollectionView> {
    const collection = await this.prisma.cardCollection.create({
      data: { userId, name, normalizedName },
    });
    return { ...collection, cardCount: 0 };
  }

  async rename(userId: string, collectionId: string, name: string, normalizedName: string): Promise<CardCollectionView | null> {
    const changed = await this.prisma.cardCollection.updateMany({
      where: { id: collectionId, userId },
      data: { name, normalizedName },
    });
    if (changed.count !== 1) return null;
    const collection = await this.prisma.cardCollection.findUnique({
      where: { id: collectionId },
      include: {
        _count: {
          select: { cards: { where: { status: "completed", deletedAt: null } } },
        },
      },
    });
    return collection ? {
      id: collection.id,
      name: collection.name,
      cardCount: collection._count.cards,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    } : null;
  }

  async remove(userId: string, collectionId: string): Promise<boolean> {
    const result = await this.prisma.cardCollection.deleteMany({ where: { id: collectionId, userId } });
    return result.count === 1;
  }

  async move(input: {
    userId: string;
    cardIds: string[];
    collectionId: string | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (input.collectionId) {
        const collection = await tx.cardCollection.findFirst({
          where: { id: input.collectionId, userId: input.userId },
          select: { id: true },
        });
        if (!collection) throw new Error("CARD_COLLECTION_NOT_FOUND");
      }
      const changed = await tx.card.updateMany({
        where: {
          id: { in: input.cardIds },
          userId: input.userId,
          status: "completed",
          deletedAt: null,
        },
        data: { collectionId: input.collectionId },
      });
      if (changed.count !== input.cardIds.length) throw new Error("CARD_RECORD_NOT_FOUND");
    });
  }

  async updateTopic(input: {
    userId: string;
    cardId: string;
    topic: string;
  }): Promise<boolean> {
    const changed = await this.prisma.card.updateMany({
      where: {
        id: input.cardId,
        userId: input.userId,
        status: "completed",
        deletedAt: null,
      },
      data: { topic: input.topic, topicEditedAt: new Date() },
    });
    return changed.count === 1;
  }
}
