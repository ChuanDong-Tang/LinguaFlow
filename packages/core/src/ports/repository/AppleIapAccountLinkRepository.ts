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
}
