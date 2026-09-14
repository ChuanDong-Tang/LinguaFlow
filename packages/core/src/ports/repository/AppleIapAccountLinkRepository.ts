export interface AppleIapAccountLinkEntity {
  appAccountToken: string;
  userId: string;
  originalTransactionId: string | null;
  latestTransactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppleIapAccountLinkRepository {
  findByAppAccountToken(appAccountToken: string): Promise<AppleIapAccountLinkEntity | null>;
  findByOriginalTransactionId(originalTransactionId: string): Promise<AppleIapAccountLinkEntity | null>;
  upsert(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId?: string | null;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity>;
  claimOriginalTransaction(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId: string;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity>;
  claimOriginalTransactionIfUnbound(input: {
    appAccountToken: string;
    userId: string;
    originalTransactionId: string;
    latestTransactionId?: string | null;
  }): Promise<AppleIapAccountLinkEntity>;
  transferActiveSubscriptionOwnership(input: {
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
  }>;
}
