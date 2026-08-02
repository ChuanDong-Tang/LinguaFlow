import type { PrismaClient } from "@prisma/client";

export interface CardCollectionView {
  id: string;
  parentId: string | null;
  sortOrder: number;
  isFavorite: boolean;
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
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
        parentId: collection.parentId,
        sortOrder: collection.sortOrder,
        isFavorite: collection.isFavorite,
        name: collection.name,
        cardCount: collection._count.cards,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
      })),
      unclassifiedCount,
    };
  }

  async create(userId: string, name: string, normalizedName: string, parentId: string | null): Promise<CardCollectionView> {
    if (parentId) {
      const parent = await this.prisma.cardCollection.findFirst({ where: { id: parentId, userId }, select: { id: true } });
      if (!parent) throw new Error("CARD_COLLECTION_PARENT_NOT_FOUND");
    }
    const lastSibling = await this.prisma.cardCollection.findFirst({
      where: { userId, parentId },
      orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
      select: { sortOrder: true },
    });
    const collection = await this.prisma.cardCollection.create({
      data: { userId, name, normalizedName, parentId, sortOrder: (lastSibling?.sortOrder ?? -1) + 1 },
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
      parentId: collection.parentId,
      sortOrder: collection.sortOrder,
      isFavorite: collection.isFavorite,
      name: collection.name,
      cardCount: collection._count.cards,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    } : null;
  }

  async setFavorite(userId: string, collectionId: string, isFavorite: boolean): Promise<boolean> {
    const changed = await this.prisma.cardCollection.updateMany({
      where: { id: collectionId, userId },
      data: { isFavorite },
    });
    return changed.count === 1;
  }

  async remove(userId: string, collectionId: string): Promise<boolean> {
    const result = await this.prisma.cardCollection.deleteMany({ where: { id: collectionId, userId } });
    return result.count === 1;
  }

  async reparent(userId: string, collectionId: string, parentId: string | null, position?: number): Promise<boolean> {
    const collections = await this.prisma.cardCollection.findMany({
      where: { userId },
      select: { id: true, parentId: true, sortOrder: true },
    });
    if (!collections.some((collection) => collection.id === collectionId)) return false;
    if (parentId && !collections.some((collection) => collection.id === parentId)) {
      throw new Error("CARD_COLLECTION_PARENT_NOT_FOUND");
    }
    let cursor = parentId;
    while (cursor) {
      if (cursor === collectionId) throw new Error("CARD_COLLECTION_CYCLE");
      cursor = collections.find((collection) => collection.id === cursor)?.parentId ?? null;
    }
    const siblings = collections
      .filter((collection) => collection.parentId === parentId && collection.id !== collectionId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
    const targetPosition = Number.isInteger(position)
      ? Math.max(0, Math.min(siblings.length, Number(position)))
      : siblings.length;
    siblings.splice(targetPosition, 0, { id: collectionId, parentId, sortOrder: targetPosition });
    await this.prisma.$transaction(siblings.map((collection, index) => this.prisma.cardCollection.updateMany({
      where: { id: collection.id, userId },
      data: {
        ...(collection.id === collectionId ? { parentId } : {}),
        sortOrder: index,
      },
    })));
    return true;
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
