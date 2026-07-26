import { parseCardRecordId } from "@lf/core/types/cardRecord.js";
import type { PrismaCardCollectionRepository } from "../../infrastructure/repository/PrismaCardCollectionRepository.js";
import { CardNotFoundError, CardValidationError } from "./CardService.js";

export class CardCollectionService {
  constructor(private readonly repository: PrismaCardCollectionRepository) {}

  async list(userId: string) {
    const result = await this.repository.list(userId);
    return {
      unclassifiedCount: result.unclassifiedCount,
      collections: result.collections.map(toView),
    };
  }

  async create(userId: string, rawName: string, parentId: string | null = null) {
    const { name, normalizedName } = normalizeCollectionName(rawName);
    try {
      return toView(await this.repository.create(userId, name, normalizedName, parentId));
    } catch (error) {
      if (isUniqueConflict(error)) throw new CardValidationError("A collection with this name already exists");
      if (error instanceof Error && error.message === "CARD_COLLECTION_PARENT_NOT_FOUND") throw new CardNotFoundError();
      throw error;
    }
  }

  async rename(userId: string, collectionId: string, rawName: string) {
    if (!collectionId) throw new CardValidationError("Invalid collection id");
    const { name, normalizedName } = normalizeCollectionName(rawName);
    try {
      const collection = await this.repository.rename(userId, collectionId, name, normalizedName);
      if (!collection) throw new CardNotFoundError();
      return toView(collection);
    } catch (error) {
      if (isUniqueConflict(error)) throw new CardValidationError("A collection with this name already exists");
      throw error;
    }
  }

  async remove(userId: string, collectionId: string): Promise<void> {
    if (!collectionId || !await this.repository.remove(userId, collectionId)) throw new CardNotFoundError();
  }

  async reparent(userId: string, collectionId: string, parentId: string | null, position?: number): Promise<void> {
    if (!collectionId) throw new CardValidationError("Invalid collection id");
    try {
      if (position !== undefined && (!Number.isInteger(position) || position < 0)) {
        throw new CardValidationError("Invalid collection position");
      }
      if (!await this.repository.reparent(userId, collectionId, parentId, position)) throw new CardNotFoundError();
    } catch (error) {
      if (error instanceof Error && error.message === "CARD_COLLECTION_PARENT_NOT_FOUND") throw new CardNotFoundError();
      if (error instanceof Error && error.message === "CARD_COLLECTION_CYCLE") {
        throw new CardValidationError("A collection cannot be moved into itself or its descendants");
      }
      throw error;
    }
  }

  async move(userId: string, recordIds: string[], collectionId: string | null): Promise<void> {
    if (!Array.isArray(recordIds) || recordIds.length < 1 || recordIds.length > 200) {
      throw new CardValidationError("Move requires 1 to 200 cards");
    }
    const refs = Array.from(new Set(recordIds)).map((recordId) => parseCardRecordId(recordId));
    if (refs.some((ref) => !ref || ref.source !== "card")) throw new CardValidationError("Invalid card id");
    try {
      await this.repository.move({
        userId,
        cardIds: refs.map((ref) => ref!.sourceId),
        collectionId,
      });
    } catch (error) {
      if (error instanceof Error && ["CARD_COLLECTION_NOT_FOUND", "CARD_RECORD_NOT_FOUND"].includes(error.message)) {
        throw new CardNotFoundError();
      }
      throw error;
    }
  }

  async updateTopic(userId: string, recordId: string, rawTopic: string): Promise<{ topic: string }> {
    const ref = parseCardRecordId(recordId);
    if (!ref || ref.source !== "card") throw new CardValidationError("Invalid card id");
    const topic = rawTopic.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!topic || Array.from(topic).length > 100) throw new CardValidationError("Topic must contain 1 to 100 characters");
    const updated = await this.repository.updateTopic({
      userId,
      cardId: ref.sourceId,
      topic,
    });
    if (!updated) throw new CardNotFoundError();
    return { topic };
  }
}

function normalizeCollectionName(rawName: string): { name: string; normalizedName: string } {
  if (typeof rawName !== "string") throw new CardValidationError("Invalid collection name");
  const name = rawName.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!name || Array.from(name).length > 50) throw new CardValidationError("Collection name must contain 1 to 50 characters");
  return { name, normalizedName: name.toLocaleLowerCase() };
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function toView(collection: { id: string; parentId: string | null; sortOrder: number; name: string; cardCount: number; createdAt: Date; updatedAt: Date }) {
  return {
    id: collection.id,
    parentId: collection.parentId,
    sortOrder: collection.sortOrder,
    name: collection.name,
    cardCount: collection.cardCount,
    createdAt: collection.createdAt.toISOString(),
    updatedAt: collection.updatedAt.toISOString(),
  };
}
