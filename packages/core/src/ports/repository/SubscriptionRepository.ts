/** SubscriptionRepository：定义订阅数据读写接口（会员订阅状态流转）。 */

export type SubscriptionPlan = "plus_monthly" | "pro_monthly";

export type SubscriptionStatus = "active" | "expired" | "cancelled";

export interface SubscriptionEntity {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startedAt: Date;
  expiresAt: Date;
  sourceOrderId: string | null;
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
}

export interface SubscriptionRepository {
  findCurrentActiveByUserId(userId: string, now: Date): Promise<SubscriptionEntity | null>;
  findBySourceOrderId(sourceOrderId: string): Promise<SubscriptionEntity | null>;
  cancelActiveBySourceOrderId(input: {
    sourceOrderId: string;
    cancelledAt: Date;
    expiresAt: Date;
  }): Promise<SubscriptionEntity | null>;
  create(input: CreateSubscriptionInput): Promise<SubscriptionEntity>;
}
