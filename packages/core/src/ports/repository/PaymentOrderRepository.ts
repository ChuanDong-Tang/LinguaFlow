import type {
  PaymentOrderStatus,
  PaymentProductCode,
  PaymentProviderName,
} from "../payment/PaymentTypes.js";

export interface PaymentOrderEntity {
  id: string;
  userId: string;
  productCode: PaymentProductCode;
  provider: PaymentProviderName;
  providerOrderId: string;
  amount: number;
  currency: "CNY";
  status: PaymentOrderStatus;
  metadata: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentOrderRecordInput {
  userId: string;
  productCode: PaymentProductCode;
  provider: PaymentProviderName;
  providerOrderId: string;
  amount: number;
  currency: "CNY";
  status: PaymentOrderStatus;
}

export interface PaymentOrderRepository {
  findRecentPending(input: {
    userId: string;
    productCode: PaymentProductCode;
    provider: PaymentProviderName;
    since: Date;
  }): Promise<PaymentOrderEntity | null>;
  findById(id: string): Promise<PaymentOrderEntity | null>;
  findByProviderOrderId(providerOrderId: string): Promise<PaymentOrderEntity | null>;
  listPendingCreatedBefore(input: {
    before: Date;
    limit: number;
  }): Promise<PaymentOrderEntity[]>;
  create(input: CreatePaymentOrderRecordInput): Promise<PaymentOrderEntity>;
  updateStatus(input: {
    id: string;
    status: PaymentOrderStatus;
    metadata?: unknown;
  }): Promise<PaymentOrderEntity>;
}
