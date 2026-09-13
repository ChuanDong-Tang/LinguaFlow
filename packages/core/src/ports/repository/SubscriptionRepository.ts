/** SubscriptionRepository：定义订阅数据读写接口（会员订阅状态流转）。 */

export type SubscriptionPlan = "plus_monthly" | "pro_monthly";

export type SubscriptionStatus = "active" | "expired" | "cancelled";
export type SubscriptionGrantSourceType = "legacy" | "manual" | "payment";
export type SubscriptionGrantProvider = "wechat" | "alipay" | "apple" | "google_play";

export interface SubscriptionEntity {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startedAt: Date;
  expiresAt: Date;
  sourceOrderId: string | null;
  sourceType: SubscriptionGrantSourceType;
  sourceProvider: SubscriptionGrantProvider | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionInput {
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startedAt: Date;
  expiresAt: Date;
  sourceOrderId?: string | null;
  sourceType?: SubscriptionGrantSourceType;
  sourceProvider?: SubscriptionGrantProvider | null;
}

export interface SubscriptionRepository {
  findActiveByUserId(userId: string, now: Date): Promise<SubscriptionEntity[]>;
  findLatestActiveBySource(input: {
    userId: string;
    now: Date;
    sourceType: SubscriptionGrantSourceType;
    sourceProvider?: SubscriptionGrantProvider | null;
  }): Promise<SubscriptionEntity | null>;
  findBySourceOrderId(sourceOrderId: string): Promise<SubscriptionEntity | null>;
  cancelActiveBySourceOrderId(input: {
    sourceOrderId: string;
    cancelledAt: Date;
    expiresAt: Date;
    sourceType?: SubscriptionGrantSourceType;
    sourceProvider?: SubscriptionGrantProvider | null;
  }): Promise<SubscriptionEntity | null>;
  syncPeriodBySourceOrderId(input: {
    sourceOrderId: string;
    plan: SubscriptionPlan;
    startedAt: Date;
    expiresAt: Date;
    sourceType?: SubscriptionGrantSourceType;
    sourceProvider?: SubscriptionGrantProvider | null;
  }): Promise<SubscriptionEntity | null>;
  create(input: CreateSubscriptionInput): Promise<SubscriptionEntity>;
}
