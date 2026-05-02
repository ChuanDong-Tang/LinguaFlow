/** EntitlementRepository：定义权益数据读写接口（额度、有效期、消耗记录）。 */

export interface EntitlementEntity {
  id: string;
  userId: string;
  dateKey: string;
  dailyTotalLimit: number;
  usedTotalChars: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnsureDailyEntitlementInput {
  userId: string;
  dateKey: string;
  dailyTotalLimit: number;
}

export interface ConsumeDailyEntitlementInput {
  userId: string;
  dateKey: string;
  chars: number;
}

export interface EntitlementRepository {
  ensureDaily(input: EnsureDailyEntitlementInput): Promise<EntitlementEntity>;
  consumeDaily(input: ConsumeDailyEntitlementInput): Promise<EntitlementEntity>;
}
