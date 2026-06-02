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
  metadata?: unknown;
}

export interface FindOrCreatePaidExternalOrderInput {
  userId: string;
  productCode: PaymentProductCode;
  provider: PaymentProviderName;
  providerOrderId: string;
  amount: number;
  currency: "CNY";
  metadata?: unknown;
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
  /** 用户手动刷新权益时，只查当前用户自己的 pending 普通支付订单。 */
  listUserPending(input: {
    userId: string;
    limit: number;
  }): Promise<PaymentOrderEntity[]>;
  /** 双端并发创建订单被数据库唯一索引挡住后，用这条查询把已存在的待支付单取回来复用。 */
  findPendingByUserProductProvider(input: {
    userId: string;
    productCode: PaymentProductCode;
    provider: PaymentProviderName;
  }): Promise<PaymentOrderEntity | null>;
  create(input: CreatePaymentOrderRecordInput): Promise<PaymentOrderEntity>;
  updateStatus(input: {
    id: string;
    status: PaymentOrderStatus;
    metadata?: unknown;
    expectedCurrentStatuses?: PaymentOrderStatus[];
  }): Promise<PaymentOrderEntity | null>;
  /**
   * Apple IAP 这类外部平台不会先走服务端预下单。
   * 验单确认成功后，用 providerOrderId 做幂等，补一条内部 paid 订单，方便后台统一查看和作为权益 sourceOrderId。
   */
  findOrCreatePaidExternalOrder(
    input: FindOrCreatePaidExternalOrderInput
  ): Promise<PaymentOrderEntity>;
}
