/** QueryPaymentContract：支付订单查询的 API 契约定义。 */

import type {
  PaymentOrderStatus,
  PaymentProductCode,
  PaymentProviderName,
} from "../../ports/payment/PaymentTypes.js";

export interface QueryPaymentOrderResponse {
  id: string;
  provider: PaymentProviderName;
  providerOrderId: string;
  productCode: PaymentProductCode;
  amount: number;
  currency: string;
  status: PaymentOrderStatus;
  createdAt: string;
  updatedAt: string;
}
