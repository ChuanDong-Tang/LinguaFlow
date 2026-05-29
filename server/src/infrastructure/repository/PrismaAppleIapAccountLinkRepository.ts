import type {
  AppleIapAccountLinkEntity,
  AppleIapAccountLinkRepository,
} from "@lf/core/ports/repository/AppleIapAccountLinkRepository.js";

type PrismaAppleIapAccountLinkClient = {
  appleIapAccountLink: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
  };
};

export class PrismaAppleIapAccountLinkRepository implements AppleIapAccountLinkRepository {
  constructor(private readonly prisma: PrismaAppleIapAccountLinkClient) {}

  async findByAppAccountToken(appAccountToken: string): Promise<AppleIapAccountLinkEntity | null> {
    const row = await this.prisma.appleIapAccountLink.findUnique({
      where: { appAccountToken },
    });

    return row ? this.toEntity(row) : null;
  }

  async upsert(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId?: string | null;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity> {
    const row = await this.prisma.appleIapAccountLink.upsert({
      where: { appAccountToken: input.appAccountToken },
      create: {
        appAccountToken: input.appAccountToken,
        userId: input.userId,
        originalTransactionId: input.originalTransactionId ?? null,
        latestTransactionId: input.latestTransactionId ?? null,
      },
      update: {
        userId: input.userId,
        ...(input.originalTransactionId === undefined
          ? {}
          : { originalTransactionId: input.originalTransactionId }),
        ...(input.latestTransactionId === undefined
          ? {}
          : { latestTransactionId: input.latestTransactionId }),
      },
    });

    return this.toEntity(row);
  }

  private toEntity(row: {
    appAccountToken: string;
    userId: string;
    originalTransactionId: string | null;
    latestTransactionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): AppleIapAccountLinkEntity {
    return {
      appAccountToken: row.appAccountToken,
      userId: row.userId,
      originalTransactionId: row.originalTransactionId,
      latestTransactionId: row.latestTransactionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
