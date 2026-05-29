import type {
  AutoRenewChargeEntity,
  AutoRenewRepository,
  AutoRenewSubscriptionEntity,
  CreateAutoRenewSubscriptionInput,
  UpsertAutoRenewChargeInput,
} from "@lf/core/ports/repository/AutoRenewRepository.js";

type PrismaAutoRenewClient = {
  autoRenewSubscription: {
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  autoRenewCharge: {
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    upsert: (args: any) => Promise<any>;
  };
};

export class PrismaAutoRenewRepository implements AutoRenewRepository {
  constructor(private readonly prisma: PrismaAutoRenewClient) {}

  async findById(id: string): Promise<AutoRenewSubscriptionEntity | null> {
    const row = await this.prisma.autoRenewSubscription.findUnique({
      where: { id },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async findActiveByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null> {
    const row = await this.prisma.autoRenewSubscription.findFirst({
      where: {
        userId,
        status: {
          in: ["active", "billing_retry"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async findCurrentByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null> {
    const row = await this.prisma.autoRenewSubscription.findFirst({
      where: {
        userId,
        status: {
          in: ["pending", "active", "billing_retry"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async findPendingByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null> {
    const row = await this.prisma.autoRenewSubscription.findFirst({
      where: {
        userId,
        status: {
          in: ["pending"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async findLatestByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null> {
    // 不能只查 active：用户取消自动续费后，记录会变成 cancelled，
    // 但当前已付费 Pro 可能还没到期，这时要靠最近记录判断是否禁止换渠道重签。
    const row = await this.prisma.autoRenewSubscription.findFirst({
      where: {
        userId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async listDueForBilling(input: {
    now: Date;
    limit: number;
  }): Promise<AutoRenewSubscriptionEntity[]> {
    const rows = await this.prisma.autoRenewSubscription.findMany({
      where: {
        provider: "wechat",
        status: {
          in: ["active", "billing_retry"],
        },
        nextBillingAt: {
          lte: input.now,
        },
      },
      orderBy: {
        nextBillingAt: "asc",
      },
      take: input.limit,
    });
    return rows.map((row: any) => this.toSubscriptionEntity(row));
  }

  async findByProviderAgreement(input: {
    provider: "wechat" | "apple";
    providerAgreementId: string;
  }): Promise<AutoRenewSubscriptionEntity | null> {
    const row = await this.prisma.autoRenewSubscription.findUnique({
      where: {
        provider_providerAgreementId: {
          provider: input.provider,
          providerAgreementId: input.providerAgreementId,
        },
      },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async findByLatestTransaction(input: {
    provider: "wechat" | "apple";
    latestTransactionId: string;
  }): Promise<AutoRenewSubscriptionEntity | null> {
    const row = await this.prisma.autoRenewSubscription.findFirst({
      where: {
        provider: input.provider,
        latestTransactionId: input.latestTransactionId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return row ? this.toSubscriptionEntity(row) : null;
  }

  async createSubscription(
    input: CreateAutoRenewSubscriptionInput
  ): Promise<AutoRenewSubscriptionEntity> {
    const row = await this.prisma.autoRenewSubscription.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        productCode: input.productCode,
        status: input.status,
        providerAgreementId: input.providerAgreementId,
        latestTransactionId: input.latestTransactionId ?? null,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        nextBillingAt: input.nextBillingAt ?? null,
        metadata: input.metadata ?? null,
      },
    });

    return this.toSubscriptionEntity(row);
  }

  async updateSubscription(input: {
    id: string;
    status?: "pending" | "active" | "cancelled" | "expired" | "billing_retry" | "paused";
    latestTransactionId?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    nextBillingAt?: Date | null;
    metadata?: unknown;
  }): Promise<AutoRenewSubscriptionEntity> {
    const current = await this.prisma.autoRenewSubscription.findUnique({
      where: { id: input.id },
    });
    if (!current) {
      throw new Error("AUTO_RENEW_SUBSCRIPTION_NOT_FOUND");
    }
    if (
      ["cancelled", "expired"].includes(current.status) &&
      input.status &&
      !["cancelled", "expired"].includes(input.status)
    ) {
      return this.toSubscriptionEntity(current);
    }

    const row = await this.prisma.autoRenewSubscription.update({
      where: { id: input.id },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.latestTransactionId === undefined
          ? {}
          : { latestTransactionId: input.latestTransactionId }),
        ...(input.currentPeriodStart === undefined
          ? {}
          : { currentPeriodStart: input.currentPeriodStart }),
        ...(input.currentPeriodEnd === undefined ? {} : { currentPeriodEnd: input.currentPeriodEnd }),
        ...(input.nextBillingAt === undefined ? {} : { nextBillingAt: input.nextBillingAt }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });

    return this.toSubscriptionEntity(row);
  }

  async cancelSubscription(input: {
    id: string;
    cancelledAt: Date;
    metadata?: unknown;
  }): Promise<AutoRenewSubscriptionEntity> {
    const row = await this.prisma.autoRenewSubscription.update({
      where: { id: input.id },
      data: {
        status: "cancelled",
        cancelledAt: input.cancelledAt,
        nextBillingAt: null,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });

    return this.toSubscriptionEntity(row);
  }

  async findChargeByProviderCharge(input: {
    provider: "wechat" | "apple";
    providerChargeId: string;
  }): Promise<AutoRenewChargeEntity | null> {
    const row = await this.prisma.autoRenewCharge.findUnique({
      where: {
        provider_providerChargeId: {
          provider: input.provider,
          providerChargeId: input.providerChargeId,
        },
      },
    });

    return row ? this.toChargeEntity(row) : null;
  }

  async findChargeByPeriod(input: {
    autoRenewSubscriptionId: string;
    periodKey: string;
  }): Promise<AutoRenewChargeEntity | null> {
    const row = await this.prisma.autoRenewCharge.findUnique({
      where: {
        autoRenewSubscriptionId_periodKey: {
          autoRenewSubscriptionId: input.autoRenewSubscriptionId,
          periodKey: input.periodKey,
        },
      },
    });

    return row ? this.toChargeEntity(row) : null;
  }

  async listChargesByStatuses(input: {
    provider: "wechat" | "apple";
    statuses: Array<"scheduled" | "pending" | "paid" | "failed" | "refunded">;
    before: Date;
    limit: number;
    userId?: string;
  }): Promise<AutoRenewChargeEntity[]> {
    const rows = await this.prisma.autoRenewCharge.findMany({
      where: {
        provider: input.provider,
        ...(input.userId ? { userId: input.userId } : {}),
        status: {
          in: input.statuses,
        },
        createdAt: {
          lt: input.before,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: input.limit,
    });

    return rows.map((row: any) => this.toChargeEntity(row));
  }

  async upsertCharge(input: UpsertAutoRenewChargeInput): Promise<AutoRenewChargeEntity> {
    const existing = await this.findChargeByProviderCharge({
      provider: input.provider,
      providerChargeId: input.providerChargeId,
    });
    if (existing?.status === "paid" && input.status !== "paid") {
      return existing;
    }

    const data = {
      autoRenewSubscriptionId: input.autoRenewSubscriptionId,
      userId: input.userId,
      provider: input.provider,
      productCode: input.productCode,
      providerChargeId: input.providerChargeId,
      periodKey: input.periodKey ?? null,
      status: input.status,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      paidAt: input.paidAt ?? null,
      failedAt: input.failedAt ?? null,
      refundedAt: input.refundedAt ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      rawPayload: input.rawPayload ?? null,
    };

    const row = await this.prisma.autoRenewCharge.upsert({
      where: {
        provider_providerChargeId: {
          provider: input.provider,
          providerChargeId: input.providerChargeId,
        },
      },
      create: data,
      update: data,
    });

    return this.toChargeEntity(row);
  }

  private toSubscriptionEntity(row: {
    id: string;
    userId: string;
    provider: "wechat" | "apple";
    productCode: "pro_monthly";
    status: "pending" | "active" | "cancelled" | "expired" | "billing_retry" | "paused";
    providerAgreementId: string;
    latestTransactionId: string | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    nextBillingAt: Date | null;
    cancelledAt: Date | null;
    metadata: unknown | null;
    createdAt: Date;
    updatedAt: Date;
  }): AutoRenewSubscriptionEntity {
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider,
      productCode: row.productCode,
      status: row.status,
      providerAgreementId: row.providerAgreementId,
      latestTransactionId: row.latestTransactionId,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      nextBillingAt: row.nextBillingAt,
      cancelledAt: row.cancelledAt,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toChargeEntity(row: {
    id: string;
    autoRenewSubscriptionId: string;
    userId: string;
    provider: "wechat" | "apple";
    productCode: "pro_monthly";
    providerChargeId: string;
    periodKey: string | null;
    status: "scheduled" | "pending" | "paid" | "failed" | "refunded";
    amount: number | null;
    currency: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    paidAt: Date | null;
    failedAt: Date | null;
    refundedAt: Date | null;
    errorCode: string | null;
    errorMessage: string | null;
    rawPayload: unknown | null;
    createdAt: Date;
    updatedAt: Date;
  }): AutoRenewChargeEntity {
    return {
      id: row.id,
      autoRenewSubscriptionId: row.autoRenewSubscriptionId,
      userId: row.userId,
      provider: row.provider,
      productCode: row.productCode,
      providerChargeId: row.providerChargeId,
      periodKey: row.periodKey,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      paidAt: row.paidAt,
      failedAt: row.failedAt,
      refundedAt: row.refundedAt,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      rawPayload: row.rawPayload,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
