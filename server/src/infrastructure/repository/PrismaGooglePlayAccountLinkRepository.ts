import type {
  GooglePlayAccountLinkEntity,
  GooglePlayAccountLinkRepository,
} from "@lf/core/ports/repository/GooglePlayAccountLinkRepository.js";

type PrismaGooglePlayAccountLinkClient = {
  $transaction?: <T>(fn: (tx: PrismaGooglePlayAccountLinkClient) => Promise<T>) => Promise<T>;
  $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
  googlePlayAccountLink: {
    findUnique: (args: any) => Promise<any>;
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  autoRenewSubscription: any;
  autoRenewCharge: any;
  paymentOrder: any;
  subscription: any;
  benefitGrant: any;
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

  async transferActiveSubscriptionOwnership(input: {
    toUserId: string;
    obfuscatedAccountId: string;
    purchaseToken: string;
    latestOrderId: string | null;
    productCode: string;
    periodStart: Date | null;
    periodEnd: Date;
    transferredAt: Date;
  }): Promise<{
    fromUserId: string;
    toUserId: string;
    autoRenewSubscriptionId: string;
    movedEntitlementCount: number;
    alreadyTransferred: boolean;
  }> {
    if (!this.prisma.$transaction) {
      throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_TRANSACTION_REQUIRED");
    }

    return this.prisma.$transaction(async (client) => {
      if (!client.$queryRawUnsafe) {
        throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_LOCK_UNAVAILABLE");
      }
      await client.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        `google-play-subscription-transfer-target:${input.toUserId}`,
      );
      await client.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
        `google-play-subscription-transfer:${input.purchaseToken}`,
      );

      const subscription = await client.autoRenewSubscription.findUnique({
        where: {
          provider_providerAgreementId: {
            provider: "google_play",
            providerAgreementId: input.purchaseToken,
          },
        },
      });
      if (!subscription) throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_SOURCE_NOT_FOUND");
      if (input.periodEnd <= input.transferredAt) {
        throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_SOURCE_EXPIRED");
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
      if (input.latestOrderId && previousTransfer.latestOrderId === input.latestOrderId) {
        throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_ALREADY_USED_FOR_PERIOD");
      }

      const conflictingTarget = await client.autoRenewSubscription.findFirst({
        where: {
          id: { not: subscription.id },
          userId: input.toUserId,
          status: { in: ["pending", "active", "billing_retry"] },
        },
      });
      if (conflictingTarget) throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_TARGET_HAS_AUTORENEW");

      const sourceLink = await client.googlePlayAccountLink.findUnique({
        where: { purchaseToken: input.purchaseToken },
      });
      if (sourceLink && sourceLink.userId !== fromUserId) {
        throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_OWNERSHIP_INCONSISTENT");
      }
      const targetLink = await client.googlePlayAccountLink.findUnique({
        where: { obfuscatedAccountId: input.obfuscatedAccountId },
      });
      if (targetLink && targetLink.userId !== input.toUserId) {
        throw new Error("GOOGLE_PLAY_ACCOUNT_ID_ALREADY_BOUND");
      }

      const order = await client.paymentOrder.findUnique({
        where: { providerOrderId: input.purchaseToken },
      });
      const charges = await client.autoRenewCharge.findMany({
        where: { autoRenewSubscriptionId: subscription.id },
        select: { providerChargeId: true },
      });
      const entitlementSourceOrderIds = Array.from(new Set([
        ...(order?.id ? [order.id] : []),
        ...charges.map((charge: { providerChargeId: string }) => `google_play_iap:${charge.providerChargeId}`),
      ]));
      const conflictingPaidMembership = await client.subscription.findFirst({
        where: {
          userId: input.toUserId,
          status: "active",
          expiresAt: { gt: input.transferredAt },
          sourceType: "payment",
          OR: [
            { sourceProvider: { not: "google_play" } },
            { sourceProvider: null },
            { sourceOrderId: { notIn: entitlementSourceOrderIds } },
            { sourceOrderId: null },
          ],
        },
        select: { id: true },
      });
      if (conflictingPaidMembership) {
        throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_TARGET_HAS_PAID_MEMBERSHIP");
      }

      if (sourceLink && sourceLink.obfuscatedAccountId !== input.obfuscatedAccountId) {
        await client.googlePlayAccountLink.update({
          where: { obfuscatedAccountId: sourceLink.obfuscatedAccountId },
          data: { purchaseToken: null },
        });
      }
      await client.googlePlayAccountLink.upsert({
        where: { obfuscatedAccountId: input.obfuscatedAccountId },
        create: {
          obfuscatedAccountId: input.obfuscatedAccountId,
          userId: input.toUserId,
          purchaseToken: input.purchaseToken,
          latestOrderId: input.latestOrderId,
        },
        update: {
          purchaseToken: input.purchaseToken,
          latestOrderId: input.latestOrderId,
        },
      });

      await client.autoRenewSubscription.update({
        where: { id: subscription.id },
        data: {
          userId: input.toUserId,
          productCode: input.productCode,
          status: "active",
          latestTransactionId: input.latestOrderId ?? subscription.latestTransactionId,
          currentPeriodStart: input.periodStart,
          currentPeriodEnd: input.periodEnd,
          cancelledAt: null,
          metadata: {
            ...metadata,
            localObfuscatedAccountId: input.obfuscatedAccountId,
            providerObfuscatedAccountId: sourceLink?.obfuscatedAccountId ?? null,
            ownershipTransfer: {
              fromUserId,
              toUserId: input.toUserId,
              latestOrderId: input.latestOrderId,
              transferredAt: input.transferredAt.toISOString(),
            },
          },
        },
      });
      await client.autoRenewCharge.updateMany({
        where: { autoRenewSubscriptionId: subscription.id },
        data: { userId: input.toUserId },
      });
      if (order) {
        await client.paymentOrder.update({
          where: { id: order.id },
          data: { userId: input.toUserId },
        });
      }
      if (entitlementSourceOrderIds.length > 0) {
        await client.benefitGrant.updateMany({
          where: {
            userId: fromUserId,
            sourceOrderId: { in: entitlementSourceOrderIds },
            status: { in: ["pending", "failed"] },
          },
          data: { userId: input.toUserId },
        });
        const processingGrant = await client.benefitGrant.findFirst({
          where: {
            userId: fromUserId,
            sourceOrderId: { in: entitlementSourceOrderIds },
            status: "processing",
          },
          select: { id: true },
        });
        if (processingGrant) throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_GRANT_IN_PROGRESS");
      }
      const movedEntitlements = entitlementSourceOrderIds.length > 0
        ? await client.subscription.updateMany({
            where: {
              userId: fromUserId,
              sourceOrderId: { in: entitlementSourceOrderIds },
              sourceType: "payment",
              sourceProvider: "google_play",
              status: "active",
              expiresAt: { gt: input.transferredAt },
            },
            data: { userId: input.toUserId },
          })
        : { count: 0 };
      if (movedEntitlements.count === 0) {
        throw new Error("GOOGLE_PLAY_SUBSCRIPTION_TRANSFER_ACTIVE_ENTITLEMENT_MISSING");
      }

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
