import type {
  AppleIapAccountLinkEntity,
  AppleIapAccountLinkRepository,
} from "@lf/core/ports/repository/AppleIapAccountLinkRepository.js";

type PrismaAppleIapAccountLinkClient = {
  $transaction?: <T>(fn: (tx: PrismaAppleIapAccountLinkClient) => Promise<T>) => Promise<T>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  appleIapAccountLink: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
  };
  autoRenewSubscription: {
    findFirst: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  autoRenewCharge: {
    findMany: (args: any) => Promise<any[]>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  subscription: {
    findFirst: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  benefitGrant: {
    findFirst: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
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

  async transferActiveSubscriptionOwnership(input: {
    toUserId: string;
    appAccountToken: string;
    originalTransactionId: string;
    latestTransactionId: string;
    productCode: string;
    periodStart: Date | null;
    periodEnd: Date;
    entitlementSourceOrderIds: string[];
    transferredAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<{
    fromUserId: string;
    toUserId: string;
    autoRenewSubscriptionId: string;
    movedEntitlementCount: number;
    alreadyTransferred: boolean;
  }> {
    if (!this.prisma.$transaction) {
      throw new Error("APPLE_SUBSCRIPTION_TRANSFER_TRANSACTION_REQUIRED");
    }

    return this.prisma.$transaction(async (client) => {
      // Serialize both the destination account and the Apple agreement. The
      // destination lock prevents two different agreements being transferred
      // into the same OIO account at the same time.
      await client.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        `apple-subscription-transfer-target:${input.toUserId}`,
      );
      await client.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        `apple-subscription-transfer:${input.originalTransactionId}`,
      );

      const subscription = await client.autoRenewSubscription.findUnique({
        where: {
          provider_providerAgreementId: {
            provider: "apple",
            providerAgreementId: input.originalTransactionId,
          },
        },
      });
      if (!subscription) throw new Error("APPLE_SUBSCRIPTION_TRANSFER_SOURCE_NOT_FOUND");
      if (input.periodEnd <= input.transferredAt) {
        throw new Error("APPLE_SUBSCRIPTION_TRANSFER_SOURCE_EXPIRED");
      }

      const fromUserId = subscription.userId;
      if (fromUserId === input.toUserId) {
        return {
          fromUserId,
          toUserId: input.toUserId,
          autoRenewSubscriptionId: subscription.id,
          movedEntitlementCount: 0,
          alreadyTransferred: true,
        };
      }

      const metadata = asRecord(subscription.metadata);
      const previousTransfer = asRecord(metadata.ownershipTransfer);
      if (previousTransfer.latestTransactionId === input.latestTransactionId) {
        throw new Error("APPLE_SUBSCRIPTION_TRANSFER_ALREADY_USED_FOR_PERIOD");
      }

      const conflictingTarget = await client.autoRenewSubscription.findFirst({
        where: {
          id: { not: subscription.id },
          userId: input.toUserId,
          status: { in: ["pending", "active", "billing_retry"] },
        },
      });
      if (conflictingTarget) throw new Error("APPLE_SUBSCRIPTION_TRANSFER_TARGET_HAS_AUTORENEW");

      const linkByOriginal = await client.appleIapAccountLink.findUnique({
        where: { originalTransactionId: input.originalTransactionId },
      });
      if (linkByOriginal && linkByOriginal.userId !== fromUserId) {
        throw new Error("APPLE_SUBSCRIPTION_TRANSFER_OWNERSHIP_INCONSISTENT");
      }
      const linkByTargetToken = await client.appleIapAccountLink.findUnique({
        where: { appAccountToken: input.appAccountToken },
      });
      if (linkByTargetToken && linkByTargetToken.userId !== input.toUserId) {
        throw new Error("APPLE_IAP_APP_ACCOUNT_TOKEN_ALREADY_BOUND");
      }

      const charges = await client.autoRenewCharge.findMany({
        where: { autoRenewSubscriptionId: subscription.id },
        select: { providerChargeId: true },
      });
      const entitlementSourceOrderIds = Array.from(new Set([
        ...input.entitlementSourceOrderIds,
        ...charges.map((charge) => `apple_iap:${charge.providerChargeId}`),
      ]));
      const conflictingPaidMembership = await client.subscription.findFirst({
        where: {
          userId: input.toUserId,
          status: "active",
          expiresAt: { gt: input.transferredAt },
          sourceType: "payment",
          OR: [
            { sourceProvider: { not: "apple" } },
            { sourceProvider: null },
            { sourceOrderId: { notIn: entitlementSourceOrderIds } },
            { sourceOrderId: null },
          ],
        },
        select: { id: true },
      });
      if (conflictingPaidMembership) {
        throw new Error("APPLE_SUBSCRIPTION_TRANSFER_TARGET_HAS_PAID_MEMBERSHIP");
      }

      if (linkByOriginal && linkByOriginal.appAccountToken !== input.appAccountToken) {
        await client.appleIapAccountLink.update({
          where: { appAccountToken: linkByOriginal.appAccountToken },
          data: { originalTransactionId: null, latestTransactionId: null },
        });
      }
      await client.appleIapAccountLink.upsert({
        where: { appAccountToken: input.appAccountToken },
        create: {
          appAccountToken: input.appAccountToken,
          userId: input.toUserId,
          originalTransactionId: input.originalTransactionId,
          latestTransactionId: input.latestTransactionId,
        },
        update: {
          originalTransactionId: input.originalTransactionId,
          latestTransactionId: input.latestTransactionId,
        },
      });

      await client.autoRenewSubscription.update({
        where: { id: subscription.id },
        data: {
          userId: input.toUserId,
          productCode: input.productCode,
          status: "active",
          latestTransactionId: input.latestTransactionId,
          currentPeriodStart: input.periodStart,
          currentPeriodEnd: input.periodEnd,
          nextBillingAt: input.periodEnd,
          cancelledAt: null,
          metadata: {
            ...metadata,
            ...input.metadata,
            ownershipTransfer: {
              fromUserId,
              toUserId: input.toUserId,
              latestTransactionId: input.latestTransactionId,
              transferredAt: input.transferredAt.toISOString(),
            },
          },
        },
      });
      await client.autoRenewCharge.updateMany({
        where: { autoRenewSubscriptionId: subscription.id },
        data: { userId: input.toUserId },
      });
      await client.benefitGrant.updateMany({
        where: {
          userId: fromUserId,
          sourceOrderId: { in: entitlementSourceOrderIds },
          status: { in: ["pending", "failed"] },
        },
        data: { userId: input.toUserId },
      });
      const grantStillProcessingForOldUser = await client.benefitGrant.findFirst({
        where: {
          userId: fromUserId,
          sourceOrderId: { in: entitlementSourceOrderIds },
          status: "processing",
        },
        select: { id: true },
      });
      if (grantStillProcessingForOldUser) {
        throw new Error("APPLE_SUBSCRIPTION_TRANSFER_GRANT_IN_PROGRESS");
      }
      const movedEntitlements = await client.subscription.updateMany({
        where: {
          userId: fromUserId,
          sourceOrderId: { in: entitlementSourceOrderIds },
          sourceType: "payment",
          sourceProvider: "apple",
          status: "active",
          expiresAt: { gt: input.transferredAt },
        },
        data: { userId: input.toUserId },
      });

      return {
        fromUserId,
        toUserId: input.toUserId,
        autoRenewSubscriptionId: subscription.id,
        movedEntitlementCount: movedEntitlements.count,
        alreadyTransferred: false,
      };
    });
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

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
