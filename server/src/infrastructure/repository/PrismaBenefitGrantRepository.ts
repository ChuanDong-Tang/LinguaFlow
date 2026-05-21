import type {
  BenefitGrantEntity,
  BenefitGrantRepository,
  BenefitGrantStatus,
} from "@lf/core/ports/repository/BenefitGrantRepository.js";
import type { PaymentProductCode } from "@lf/core/ports/payment/PaymentTypes.js";

type PrismaBenefitGrantClient = {
  benefitGrant: {
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
    findMany: (args: any) => Promise<any[]>;
  };
};

export class PrismaBenefitGrantRepository implements BenefitGrantRepository {
  constructor(private readonly prisma: PrismaBenefitGrantClient) {}

  async enqueue(input: {
    userId: string;
    sourceOrderId: string;
    productCode: PaymentProductCode;
    channel: "wechat" | "ios_iap";
    payload?: unknown;
  }): Promise<{ grant: BenefitGrantEntity; created: boolean }> {
    const existing = await this.prisma.benefitGrant.findUnique({
      where: {
        sourceOrderId_productCode: {
          sourceOrderId: input.sourceOrderId,
          productCode: input.productCode,
        },
      },
    });
    if (existing) {
      return { grant: this.toEntity(existing), created: false };
    }

    const created = await this.prisma.benefitGrant.create({
      data: {
        userId: input.userId,
        sourceOrderId: input.sourceOrderId,
        productCode: input.productCode,
        channel: input.channel,
        status: "pending",
        payload: input.payload ?? null,
      },
    });
    return { grant: this.toEntity(created), created: true };
  }

  async leasePending(input: { now: Date; limit: number }): Promise<BenefitGrantEntity[]> {
    const due = await this.prisma.benefitGrant.findMany({
      where: {
        status: { in: ["pending", "failed"] },
        AND: [{ OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: input.now } }] }],
      },
      orderBy: [{ createdAt: "asc" }],
      take: input.limit,
    });

    const leased: BenefitGrantEntity[] = [];
    for (const row of due) {
      const updated = await this.prisma.benefitGrant.updateMany({
        where: {
          id: row.id,
          status: {
            in: ["pending", "failed"],
          },
        },
        data: {
          status: "processing",
          attemptCount: { increment: 1 },
          lastErrorCode: null,
          lastErrorMsg: null,
        },
      });
      if (updated.count > 0) {
        leased.push(
          this.toEntity({
            ...row,
            status: "processing",
            attemptCount: Number(row.attemptCount ?? 0) + 1,
            lastErrorCode: null,
            lastErrorMsg: null,
          })
        );
      }
    }
    return leased;
  }

  async markSuccess(id: string): Promise<BenefitGrantEntity | null> {
    return this.updateWithGuard({
      id,
      expected: ["processing"],
      next: "success",
      data: {
        nextRetryAt: null,
        processedAt: new Date(),
        lastErrorCode: null,
        lastErrorMsg: null,
      },
    });
  }

  async markFailedRetryable(input: {
    id: string;
    errorCode: string;
    errorMessage: string;
    nextRetryAt: Date;
  }): Promise<BenefitGrantEntity | null> {
    return this.updateWithGuard({
      id: input.id,
      expected: ["processing"],
      next: "failed",
      data: {
        nextRetryAt: input.nextRetryAt,
        processedAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMsg: input.errorMessage,
      },
    });
  }

  async markFailedTerminal(input: {
    id: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<BenefitGrantEntity | null> {
    return this.updateWithGuard({
      id: input.id,
      expected: ["processing"],
      next: "failed",
      data: {
        nextRetryAt: null,
        processedAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMsg: input.errorMessage,
      },
    });
  }

  private async updateWithGuard(input: {
    id: string;
    expected: BenefitGrantStatus[];
    next: BenefitGrantStatus;
    data: Record<string, unknown>;
  }): Promise<BenefitGrantEntity | null> {
    const result = await this.prisma.benefitGrant.updateMany({
      where: {
        id: input.id,
        status: { in: input.expected },
      },
      data: {
        status: input.next,
        ...input.data,
      },
    });
    if (result.count === 0) return null;
    const row = await this.prisma.benefitGrant.findUnique({ where: { id: input.id } });
    return row ? this.toEntity(row) : null;
  }

  private toEntity(row: any): BenefitGrantEntity {
    return {
      id: row.id,
      userId: row.userId,
      sourceOrderId: row.sourceOrderId,
      productCode: row.productCode as PaymentProductCode,
      channel: row.channel,
      status: row.status,
      attemptCount: Number(row.attemptCount ?? 0),
      nextRetryAt: row.nextRetryAt ?? null,
      lastErrorCode: row.lastErrorCode ?? null,
      lastErrorMsg: row.lastErrorMsg ?? null,
      payload: row.payload ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      processedAt: row.processedAt ?? null,
    };
  }
}
