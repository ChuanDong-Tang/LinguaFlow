import type {
  GooglePlayAccountLinkEntity,
  GooglePlayAccountLinkRepository,
} from "@lf/core/ports/repository/GooglePlayAccountLinkRepository.js";

type PrismaGooglePlayAccountLinkClient = {
  googlePlayAccountLink: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
  };
};

export class PrismaGooglePlayAccountLinkRepository implements GooglePlayAccountLinkRepository {
  constructor(private readonly prisma: PrismaGooglePlayAccountLinkClient) {}

  async findByObfuscatedAccountId(obfuscatedAccountId: string): Promise<GooglePlayAccountLinkEntity | null> {
    const row = await this.prisma.googlePlayAccountLink.findUnique({
      where: { obfuscatedAccountId },
    });
    return row ? this.toEntity(row) : null;
  }

  async findByPurchaseToken(purchaseToken: string): Promise<GooglePlayAccountLinkEntity | null> {
    const row = await this.prisma.googlePlayAccountLink.findUnique({
      where: { purchaseToken },
    });
    return row ? this.toEntity(row) : null;
  }

  async upsert(input: {
    obfuscatedAccountId: string;
    userId: string;
    purchaseToken?: string | null;
    latestOrderId?: string | null;
  }): Promise<GooglePlayAccountLinkEntity> {
    const existing = await this.findByObfuscatedAccountId(input.obfuscatedAccountId);
    if (existing && existing.userId !== input.userId) {
      throw new Error("GOOGLE_PLAY_ACCOUNT_ID_ALREADY_BOUND");
    }

    const row = await this.prisma.googlePlayAccountLink.upsert({
      where: { obfuscatedAccountId: input.obfuscatedAccountId },
      create: {
        obfuscatedAccountId: input.obfuscatedAccountId,
        userId: input.userId,
        purchaseToken: input.purchaseToken ?? null,
        latestOrderId: input.latestOrderId ?? null,
      },
      update: {
        ...(input.purchaseToken === undefined ? {} : { purchaseToken: input.purchaseToken }),
        ...(input.latestOrderId === undefined ? {} : { latestOrderId: input.latestOrderId }),
      },
    });

    return this.toEntity(row);
  }

  async claimPurchaseToken(input: {
    obfuscatedAccountId: string;
    userId: string;
    purchaseToken: string;
    latestOrderId?: string | null;
  }): Promise<GooglePlayAccountLinkEntity> {
    const existingByToken = await this.findByPurchaseToken(input.purchaseToken);
    if (existingByToken && existingByToken.obfuscatedAccountId !== input.obfuscatedAccountId) {
      throw new Error("GOOGLE_PLAY_PURCHASE_TOKEN_ALREADY_BOUND");
    }

    try {
      return await this.upsert({
        obfuscatedAccountId: input.obfuscatedAccountId,
        userId: input.userId,
        purchaseToken: input.purchaseToken,
        latestOrderId: input.latestOrderId ?? null,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error("GOOGLE_PLAY_PURCHASE_TOKEN_ALREADY_BOUND");
      }
      throw error;
    }
  }

  private toEntity(row: {
    obfuscatedAccountId: string;
    userId: string;
    purchaseToken: string | null;
    latestOrderId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): GooglePlayAccountLinkEntity {
    return {
      obfuscatedAccountId: row.obfuscatedAccountId,
      userId: row.userId,
      purchaseToken: row.purchaseToken,
      latestOrderId: row.latestOrderId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
