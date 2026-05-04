/** QueryPaymentContract：支付订单查询的 API 契约定义。 */

import type { PaymentOrderStatus, PaymentProductCode } from "../../ports/payment/PaymentTypes.js";

export interface QueryPaymentOrderResponse {
  id: string;
  provider: "wechat";
  providerOrderId: string;
  productCode: PaymentProductCode;
  amount: number;
  currency: "CNY";
  status: PaymentOrderStatus;
  createdAt: string;
  updatedAt: string;
}
