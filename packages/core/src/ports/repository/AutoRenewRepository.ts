/** AutoRenewRepository：定义自动续费协议与每期扣款记录的数据接口。 */

export type AutoRenewProvider = "wechat" | "apple";

export type AutoRenewStatus =
  | "pending"
  | "active"
  | "cancelled"
  | "expired"
  | "billing_retry"
  | "paused";

export type AutoRenewChargeStatus = "scheduled" | "pending" | "paid" | "failed" | "refunded";

export type AutoRenewProductCode = "pro_monthly";

export interface AutoRenewSubscriptionEntity {
  id: string;
  userId: string;
  provider: AutoRenewProvider;
  productCode: AutoRenewProductCode;
  status: AutoRenewStatus;
  providerAgreementId: string;
  latestTransactionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  nextBillingAt: Date | null;
  cancelledAt: Date | null;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoRenewChargeEntity {
  id: string;
  autoRenewSubscriptionId: string;
  userId: string;
  provider: AutoRenewProvider;
  productCode: AutoRenewProductCode;
  providerChargeId: string;
  periodKey: string | null;
  status: AutoRenewChargeStatus;
  amount: number | null;
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawPayload: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutoRenewSubscriptionInput {
  userId: string;
  provider: AutoRenewProvider;
  productCode: AutoRenewProductCode;
  status: AutoRenewStatus;
  providerAgreementId: string;
  latestTransactionId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  nextBillingAt?: Date | null;
  metadata?: unknown | null;
}

export interface UpsertAutoRenewChargeInput {
  autoRenewSubscriptionId: string;
  userId: string;
  provider: AutoRenewProvider;
  productCode: AutoRenewProductCode;
  providerChargeId: string;
  periodKey?: string | null;
  status: AutoRenewChargeStatus;
  amount?: number | null;
  currency?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  paidAt?: Date | null;
  failedAt?: Date | null;
  refundedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawPayload?: unknown | null;
}

export interface AutoRenewRepository {
  findById(id: string): Promise<AutoRenewSubscriptionEntity | null>;
  findActiveByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null>;
  findCurrentByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null>;
  findPendingByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null>;
  /** 查用户最近一条自动续费记录，用于判断“刚取消但权益未过期时，是否禁止换渠道重签”。 */
  findLatestByUserId(userId: string): Promise<AutoRenewSubscriptionEntity | null>;
  listDueForBilling(input: {
    now: Date;
    limit: number;
  }): Promise<AutoRenewSubscriptionEntity[]>;
  findByProviderAgreement(input: {
    provider: AutoRenewProvider;
    providerAgreementId: string;
  }): Promise<AutoRenewSubscriptionEntity | null>;
  findByLatestTransaction(input: {
    provider: AutoRenewProvider;
    latestTransactionId: string;
  }): Promise<AutoRenewSubscriptionEntity | null>;
  createSubscription(input: CreateAutoRenewSubscriptionInput): Promise<AutoRenewSubscriptionEntity>;
  updateSubscription(input: {
    id: string;
    userId?: string;
    status?: AutoRenewStatus;
    latestTransactionId?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    nextBillingAt?: Date | null;
    cancelledAt?: Date | null;
    metadata?: unknown;
    allowReactivation?: boolean;
  }): Promise<AutoRenewSubscriptionEntity>;
  cancelSubscription(input: {
    id: string;
    cancelledAt: Date;
    metadata?: unknown;
  }): Promise<AutoRenewSubscriptionEntity>;
  findChargeByProviderCharge(input: {
    provider: AutoRenewProvider;
    providerChargeId: string;
  }): Promise<AutoRenewChargeEntity | null>;
  findChargeByPeriod(input: {
    autoRenewSubscriptionId: string;
    periodKey: string;
  }): Promise<AutoRenewChargeEntity | null>;
  listChargesByStatuses(input: {
    provider: AutoRenewProvider;
    statuses: AutoRenewChargeStatus[];
    before: Date;
    limit: number;
    userId?: string;
  }): Promise<AutoRenewChargeEntity[]>;
  upsertCharge(input: UpsertAutoRenewChargeInput): Promise<AutoRenewChargeEntity>;
}
