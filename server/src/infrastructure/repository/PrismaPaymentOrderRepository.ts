import type {
  CreatePaymentOrderRecordInput,
  FindOrCreatePaidExternalOrderInput,
  PaymentOrderEntity,
  PaymentOrderRepository,
} from "@lf/core/ports/repository/PaymentOrderRepository.js";
import type { PaymentProviderName } from "@lf/core/ports/payment/PaymentTypes.js";

type PrismaPaymentOrderClient = {
  paymentOrder: {
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
};

export class PrismaPaymentOrderRepository implements PaymentOrderRepository {
  constructor(private readonly prisma: PrismaPaymentOrderClient) {}

  async findRecentPending(input: {
    userId: string;
    productCode: "pro_monthly";
    provider: "wechat";
    since: Date;
  }): Promise<PaymentOrderEntity | null> {
    const row = await this.prisma.paymentOrder.findFirst({
      where: {
        userId: input.userId,
        productCode: input.productCode,
        provider: input.provider,
        status: "pending",
        createdAt: {
          gte: input.since,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async findById(id: string): Promise<PaymentOrderEntity | null> {
    const row = await this.prisma.paymentOrder.findUnique({
      where: { id },
    });

    return row ? this.toEntity(row) : null;
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentOrderEntity | null> {
    const row = await this.prisma.paymentOrder.findUnique({
      where: { providerOrderId },
    });

    return row ? this.toEntity(row) : null;
  }

  async listPendingCreatedBefore(input: {
    before: Date;
    limit: number;
  }): Promise<PaymentOrderEntity[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        status: "pending",
        createdAt: {
          lt: input.before,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: input.limit,
    });

    return rows.map((row: any) => this.toEntity(row));
  }

  // 手动刷新权益只查当前用户自己的 pending 订单
  async listUserPending(input: { userId: string; limit: number; }): Promise<PaymentOrderEntity[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        userId: input.userId,
        status: "pending",
      },
      orderBy: {
        createdAt: "desc",
      },
      take: input.limit
    });

    return rows.map((row: any) => this.toEntity(row));
  }

  async findPendingByUserProductProvider(input: {
    userId: string;
    productCode: "pro_monthly";
    provider: "wechat";
  }): Promise<PaymentOrderEntity | null> {
    // 配合 payment_orders 的 pending 部分唯一索引使用：
    // 并发创建时失败的一方回查这里，拿到已经存在的待支付单并复用。
    const row = await this.prisma.paymentOrder.findFirst({
      where: {
        userId: input.userId,
        productCode: input.productCode,
        provider: input.provider,
        status: "pending",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return row ? this.toEntity(row) : null;
  }

  async create(input: CreatePaymentOrderRecordInput): Promise<PaymentOrderEntity> {
    const row = await this.prisma.paymentOrder.create({
      data: {
        userId: input.userId,
        productCode: input.productCode,
        provider: input.provider,
        providerOrderId: input.providerOrderId,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });

    return this.toEntity(row);
  }

  async findOrCreatePaidExternalOrder(
    input: FindOrCreatePaidExternalOrderInput
  ): Promise<PaymentOrderEntity> {
    const existing = await this.findByProviderOrderId(input.providerOrderId);
    if (existing) {
      if (existing.status === "pending") {
        const paid = await this.updateStatus({
          id: existing.id,
          status: "paid",
          expectedCurrentStatuses: ["pending"],
          metadata: mergeMetadata(existing.metadata, input.metadata),
        });
        if (paid) return paid;
      }
      return existing;
    }

    try {
      return await this.create({
        userId: input.userId,
        productCode: input.productCode,
        provider: input.provider,
        providerOrderId: input.providerOrderId,
        amount: input.amount,
        currency: input.currency,
        status: "paid",
        metadata: input.metadata,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.findByProviderOrderId(input.providerOrderId);
      if (!raced) throw error;
      return raced;
    }
  }

  async updateStatus(input: {
    id: string;
    status: "pending" | "paid" | "closed" | "failed" | "refunded";
    metadata?: unknown;
    expectedCurrentStatuses?: ("pending" | "paid" | "closed" | "failed" | "refunded")[];
  }): Promise<PaymentOrderEntity | null> {
    const allowed = input.expectedCurrentStatuses ?? ["pending"];
    const result = await this.prisma.paymentOrder.updateMany({
      where: {
        id: input.id,
        status: {
          in: allowed,
        },
      },
      data: {
        status: input.status,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });

    if (result.count === 0) {
      return null;
    }
    
    const row = await this.prisma.paymentOrder.findUnique({
      where: { id: input.id },
    });

    return row ? this.toEntity(row) : null;
  }

  private toEntity(row: {
    id: string;
    userId: string;
    productCode: "pro_monthly";
    provider: PaymentProviderName;
    providerOrderId: string;
    amount: number;
    currency: "CNY";
    status: "pending" | "paid" | "closed" | "failed" | "refunded";
    metadata: unknown | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentOrderEntity {
    return {
      id: row.id,
      userId: row.userId,
      productCode: row.productCode,
      provider: row.provider,
      providerOrderId: row.providerOrderId,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function mergeMetadata(existing: unknown, patch: unknown): unknown {
  if (patch === undefined) return existing ?? null;
  if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    patch &&
    typeof patch === "object" &&
    !Array.isArray(patch)
  ) {
    return {
      ...(existing as Record<string, unknown>),
      ...(patch as Record<string, unknown>),
    };
  }
  return patch;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
