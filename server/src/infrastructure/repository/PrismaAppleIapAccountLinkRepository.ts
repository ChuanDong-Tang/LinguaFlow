import type {
  AppleIapAccountLinkEntity,
  AppleIapAccountLinkRepository,
} from "@lf/core/ports/repository/AppleIapAccountLinkRepository.js";

type PrismaAppleIapAccountLinkClient = {
  $transaction?: <T>(fn: (tx: PrismaAppleIapAccountLinkClient) => Promise<T>) => Promise<T>;
  appleIapAccountLink: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
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

  async findByOriginalTransactionId(originalTransactionId: string): Promise<AppleIapAccountLinkEntity | null> {
    const row = await this.prisma.appleIapAccountLink.findUnique({
      where: { originalTransactionId },
    });

    return row ? this.toEntity(row) : null;
  }

  async upsert(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId?: string | null;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity> {
    const existing = await this.findByAppAccountToken(input.appAccountToken);
    if (existing && existing.userId !== input.userId) {
      throw new Error("APPLE_IAP_APP_ACCOUNT_TOKEN_ALREADY_BOUND");
    }

    const row = await this.prisma.appleIapAccountLink.upsert({
      where: { appAccountToken: input.appAccountToken },
      create: {
        appAccountToken: input.appAccountToken,
        userId: input.userId,
        originalTransactionId: input.originalTransactionId ?? null,
        latestTransactionId: input.latestTransactionId ?? null,
      },
      update: {
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

  async claimOriginalTransaction(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId: string;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity> {
    const run = async (client: PrismaAppleIapAccountLinkClient): Promise<AppleIapAccountLinkEntity> => {
      const existingByToken = await client.appleIapAccountLink.findUnique({
        where: { appAccountToken: input.appAccountToken },
      });
      if (existingByToken && existingByToken.userId !== input.userId) {
        throw new Error("APPLE_IAP_APP_ACCOUNT_TOKEN_ALREADY_BOUND");
      }

      const existingByOriginal = await client.appleIapAccountLink.findUnique({
        where: { originalTransactionId: input.originalTransactionId },
      });
      if (existingByOriginal && existingByOriginal.appAccountToken !== input.appAccountToken) {
        await client.appleIapAccountLink.update({
          where: { appAccountToken: existingByOriginal.appAccountToken },
          data: {
            originalTransactionId: null,
            latestTransactionId: null,
          },
        });
      }

      let row;
      try {
        row = await client.appleIapAccountLink.upsert({
          where: { appAccountToken: input.appAccountToken },
          create: {
            appAccountToken: input.appAccountToken,
            userId: input.userId,
            originalTransactionId: input.originalTransactionId,
            latestTransactionId: input.latestTransactionId ?? null,
          },
          update: {
            originalTransactionId: input.originalTransactionId,
            latestTransactionId: input.latestTransactionId ?? null,
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error("APPLE_IAP_ORIGINAL_TRANSACTION_ALREADY_BOUND");
        }
        throw error;
      }

      return this.toEntity(row);
    };

    return this.prisma.$transaction ? this.prisma.$transaction(run) : run(this.prisma);
  }

  async claimOriginalTransactionIfUnbound(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId: string;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity> {
    const run = async (client: PrismaAppleIapAccountLinkClient): Promise<AppleIapAccountLinkEntity> => {
      const existingByToken = await client.appleIapAccountLink.findUnique({
        where: { appAccountToken: input.appAccountToken },
      });
      if (existingByToken && existingByToken.userId !== input.userId) {
        throw new Error("APPLE_IAP_APP_ACCOUNT_TOKEN_ALREADY_BOUND");
      }

      const existingByOriginal = await client.appleIapAccountLink.findUnique({
        where: { originalTransactionId: input.originalTransactionId },
      });
      if (existingByOriginal && existingByOriginal.appAccountToken !== input.appAccountToken) {
        throw new Error("APPLE_IAP_ORIGINAL_TRANSACTION_ALREADY_BOUND");
      }

      let row;
      try {
        row = await client.appleIapAccountLink.upsert({
          where: { appAccountToken: input.appAccountToken },
          create: {
            appAccountToken: input.appAccountToken,
            userId: input.userId,
            originalTransactionId: input.originalTransactionId,
            latestTransactionId: input.latestTransactionId ?? null,
          },
          update: {
            originalTransactionId: input.originalTransactionId,
            latestTransactionId: input.latestTransactionId ?? null,
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error("APPLE_IAP_ORIGINAL_TRANSACTION_ALREADY_BOUND");
        }
        throw error;
      }

      return this.toEntity(row);
    };

    return this.prisma.$transaction ? this.prisma.$transaction(run) : run(this.prisma);
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

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
