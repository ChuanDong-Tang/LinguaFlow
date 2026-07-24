/** EntitlementRepository：定义权益数据读写接口（额度、有效期、消耗记录）。 */

export interface EntitlementEntity {
  id: string;
  userId: string;
  dateKey: string;
  dailyTotalLimit: number;
  usedTotalChars: number;
  imageLimit: number;
  usedImages: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnsureDailyEntitlementInput {
  userId: string;
  dateKey: string;
  dailyTotalLimit: number;
  imageLimit: number;
}

export interface ConsumeDailyEntitlementInput {
  userId: string;
  dateKey: string;
  chars: number;
}

export interface EntitlementRepository {
  ensureDaily(input: EnsureDailyEntitlementInput): Promise<EntitlementEntity>;
  consumeDaily(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity>;
  tryConsumeDaily(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity | null>;
  consumeDailyUpToLimit(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity>;
}
