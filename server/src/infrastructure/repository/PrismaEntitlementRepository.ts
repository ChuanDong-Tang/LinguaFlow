/** PrismaEntitlementRepository：EntitlementRepository 的 Prisma 实现。 */

import type {
  ConsumeDailyEntitlementInput,
  EnsureDailyEntitlementInput,
  EntitlementEntity,
  EntitlementRepository,
} from "@lf/core/ports/repository/EntitlementRepository.js";

type PrismaEntitlementClient = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  entitlement: {
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    findUnique: (args: any) => Promise<any>;
  };
};

export class PrismaEntitlementRepository implements EntitlementRepository {
  constructor(private readonly prisma: PrismaEntitlementClient) {}

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
        imageLimit: input.imageLimit,
        usedImages: 0,
      },
      update: {
        dailyTotalLimit: {
          increment: 0,
        },
      },
    });

    if (row.dailyTotalLimit < input.dailyTotalLimit || row.imageLimit < input.imageLimit) {
      const updated = await this.prisma.entitlement.update({
        where: {
          userId_dateKey: {
            userId: input.userId,
            dateKey: input.dateKey,
          },
        },
        data: {
          dailyTotalLimit: Math.max(row.dailyTotalLimit, input.dailyTotalLimit),
          imageLimit: Math.max(row.imageLimit, input.imageLimit),
        },
      });

      return this.toEntity(updated);
    }

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

  async tryConsumeDaily(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity | null> {
    const changed = await this.prisma.$executeRawUnsafe(
      `
        UPDATE "entitlements"
        SET "usedTotalChars" = "usedTotalChars" + $1,
            "updatedAt" = NOW()
        WHERE "userId" = $2
          AND "dateKey" = $3
          AND "usedTotalChars" + $1 <= "dailyTotalLimit"
      `,
      input.chars,
      input.userId,
      input.dateKey
    );

    if (changed === 0) return null;

    const row = await this.prisma.entitlement.findUnique({
      where: {
        userId_dateKey: {
          userId: input.userId,
          dateKey: input.dateKey,
        },
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async consumeDailyUpToLimit(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity> {
    await this.prisma.$executeRawUnsafe(
      `
        UPDATE "entitlements"
        SET "usedTotalChars" = LEAST("dailyTotalLimit", "usedTotalChars" + $1),
            "updatedAt" = NOW()
        WHERE "userId" = $2
          AND "dateKey" = $3
      `,
      input.chars,
      input.userId,
      input.dateKey
    );

    const row = await this.prisma.entitlement.findUnique({
      where: {
        userId_dateKey: {
          userId: input.userId,
          dateKey: input.dateKey,
        },
      },
    });

    if (!row) {
      throw new Error("Entitlement not found after capped consume");
    }

    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    userId: string;
    dateKey: string;
    dailyTotalLimit: number;
    usedTotalChars: number;
    imageLimit: number;
    usedImages: number;
    createdAt: Date;
    updatedAt: Date;
  }): EntitlementEntity {
    return {
      id: row.id,
      userId: row.userId,
      dateKey: row.dateKey,
      dailyTotalLimit: row.dailyTotalLimit,
      usedTotalChars: row.usedTotalChars,
      imageLimit: row.imageLimit,
      usedImages: row.usedImages,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
