import type { PaymentProductCode } from "../payment/PaymentTypes.js";

export type BenefitGrantStatus = "pending" | "processing" | "success" | "failed";
export type BenefitGrantChannel = "wechat" | "ios_iap" | "android_iap";

export interface BenefitGrantEntity {
  id: string;
  userId: string;
  sourceOrderId: string;
  productCode: PaymentProductCode;
  channel: BenefitGrantChannel;
  status: BenefitGrantStatus;
  attemptCount: number;
  nextRetryAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMsg: string | null;
  payload: unknown | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export interface BenefitGrantRepository {
  enqueue(input: {
    userId: string;
    sourceOrderId: string;
    productCode: PaymentProductCode;
    channel: BenefitGrantChannel;
    payload?: unknown;
  }): Promise<{ grant: BenefitGrantEntity; created: boolean }>;
  leasePending(input: { now: Date; limit: number }): Promise<BenefitGrantEntity[]>;
  markSuccess(id: string): Promise<BenefitGrantEntity | null>;
  markFailedRetryable(input: {
    id: string;
    errorCode: string;
    errorMessage: string;
    nextRetryAt: Date;
  }): Promise<BenefitGrantEntity | null>;
  markFailedTerminal(input: {
    id: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<BenefitGrantEntity | null>;
}
