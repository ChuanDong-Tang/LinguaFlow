/** PrismaEntitlementRepository：EntitlementRepository 的 Prisma 实现。 */

import type { PrismaClient } from "@prisma/client";
import type {
  ConsumeDailyEntitlementInput,
  EnsureDailyEntitlementInput,
  EntitlementEntity,
  EntitlementRepository,
} from "@lf/core/ports/repository/EntitlementRepository.js";

export class PrismaEntitlementRepository implements EntitlementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureDaily(input: EnsureDailyEntitlementInput): Promise<EntitlementEntity> {
    const row = await this.prisma.entitlement.upsert({
      where: {
        userId_dateKey: {
          userId: input.userId,
          dateKey: input.dateKey,
        },
      },
      create: {
        userId: input.userId,
        dateKey: input.dateKey,
        dailyTotalLimit: input.dailyTotalLimit,
        usedTotalChars: 0,
      },
      update: {},
    });

    return this.toEntity(row);
  }

  async consumeDaily(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity> {
    const row = await this.prisma.entitlement.update({
      where: {
        userId_dateKey: {
          userId: input.userId,
          dateKey: input.dateKey,
        },
      },
      data: {
        usedTotalChars: {
          increment: input.chars,
        },
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    userId: string;
    dateKey: string;
    dailyTotalLimit: number;
    usedTotalChars: number;
    createdAt: Date;
    updatedAt: Date;
  }): EntitlementEntity {
    return {
      id: row.id,
      userId: row.userId,
      dateKey: row.dateKey,
      dailyTotalLimit: row.dailyTotalLimit,
      usedTotalChars: row.usedTotalChars,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
