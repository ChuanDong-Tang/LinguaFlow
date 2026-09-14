export interface GooglePlayAccountLinkEntity {
  obfuscatedAccountId: string;
  userId: string;
  purchaseToken: string | null;
  latestOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GooglePlayAccountLinkRepository {
  findByObfuscatedAccountId(obfuscatedAccountId: string): Promise<GooglePlayAccountLinkEntity | null>;
  findByPurchaseToken(purchaseToken: string): Promise<GooglePlayAccountLinkEntity | null>;
  upsert(input: {
    obfuscatedAccountId: string;
    userId: string;
    purchaseToken?: string | null;
    latestOrderId?: string | null;
  }): Promise<GooglePlayAccountLinkEntity>;
  claimPurchaseToken(input: {
    obfuscatedAccountId: string;
    userId: string;
    purchaseToken: string;
    latestOrderId?: string | null;
  }): Promise<GooglePlayAccountLinkEntity>;
  transferActiveSubscriptionOwnership(input: {
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
  }>;
}
