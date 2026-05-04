import type {
  CreatePaymentOrderRecordInput,
  PaymentOrderEntity,
  PaymentOrderRepository,
} from "@lf/core/ports/repository/PaymentOrderRepository.js";

type PrismaPaymentOrderClient = {
  paymentOrder: {
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
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
      },
    });

    return this.toEntity(row);
  }

  async updateStatus(input: {
    id: string;
    status: "pending" | "paid" | "closed" | "failed" | "refunded";
    metadata?: unknown;
  }): Promise<PaymentOrderEntity> {
    const row = await this.prisma.paymentOrder.update({
      where: { id: input.id },
      data: {
        status: input.status,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    id: string;
    userId: string;
    productCode: "pro_monthly";
    provider: "wechat";
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
