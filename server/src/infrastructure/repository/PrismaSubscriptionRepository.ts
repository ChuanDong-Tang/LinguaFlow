/** PrismaSubscriptionRepository：SubscriptionRepository 的 Prisma 实现。 */

import type {
  CreateSubscriptionInput,
  SubscriptionPlan,
  SubscriptionEntity,
  SubscriptionRepository,
} from "@lf/core/ports/repository/SubscriptionRepository.js";

type PrismaSubscriptionClient = {
  subscription: {
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    create: (args: any) => Promise<any>;
  };
};

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaSubscriptionClient) {}

  async findCurrentActiveByUserId(
    userId: string,
    now: Date
  ): Promise<SubscriptionEntity | null> {
    const row = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: "active",
        expiresAt: {
          gt: now,
        },
      },
      orderBy: {
        expiresAt: "desc",
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async findBySourceOrderId(sourceOrderId: string): Promise<SubscriptionEntity | null> {
    const row = await this.prisma.subscription.findUnique({
      where: {
        sourceOrderId,
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async cancelActiveBySourceOrderId(input: {
    sourceOrderId: string;
    cancelledAt: Date;
    expiresAt: Date;
  }): Promise<SubscriptionEntity | null> {
    const row = await this.prisma.subscription.findUnique({
      where: {
        sourceOrderId: input.sourceOrderId,
      },
    });
    if (!row || row.status !== "active" || row.expiresAt <= input.cancelledAt) return null;

    const nextExpiresAt = row.expiresAt < input.expiresAt ? row.expiresAt : input.expiresAt;
    const updated = await this.prisma.subscription.updateMany({
      where: {
        id: row.id,
        status: "active",
        expiresAt: {
          gt: input.cancelledAt,
        },
      },
      data: {
        status: "cancelled",
        expiresAt: nextExpiresAt,
      },
    });
    if (updated.count === 0) return null;

    const latest = await this.prisma.subscription.findUnique({
      where: {
        id: row.id,
      },
    });
    return latest ? this.toEntity(latest) : null;
  }

  async syncPeriodBySourceOrderId(input: {
    sourceOrderId: string;
    plan: SubscriptionPlan;
    startedAt: Date;
    expiresAt: Date;
  }): Promise<SubscriptionEntity | null> {
    const current = await this.prisma.subscription.findUnique({
      where: { sourceOrderId: input.sourceOrderId },
    });
    if (!current) return null;

    await this.prisma.subscription.updateMany({
      where: { id: current.id },
      data: {
        plan: input.plan,
        status: "active",
        startedAt: current.startedAt < input.startedAt ? current.startedAt : input.startedAt,
        expiresAt: current.expiresAt > input.expiresAt ? current.expiresAt : input.expiresAt,
      },
    });
    const latest = await this.prisma.subscription.findUnique({
      where: { id: current.id },
    });
    return latest ? this.toEntity(latest) : null;
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionEntity> {
    const row = await this.prisma.subscription.create({
      data: {
        userId: input.userId,
        plan: input.plan,
        status: input.status,
        startedAt: input.startedAt,
        expiresAt: input.expiresAt,
        sourceOrderId: input.sourceOrderId ?? null,
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    userId: string;
    plan: SubscriptionPlan;
    status: "active" | "expired" | "cancelled";
    startedAt: Date;
    expiresAt: Date;
    sourceOrderId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): SubscriptionEntity {
    return {
      id: row.id,
      userId: row.userId,
      plan: row.plan,
      status: row.status,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      sourceOrderId: row.sourceOrderId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
