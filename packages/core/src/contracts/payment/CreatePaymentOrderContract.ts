/** CreatePaymentOrderContract：创建支付订单的 API 契约定义。 */

import type { PaymentProductCode, WeChatAppPayParams } from "../../ports/payment/PaymentTypes.js";

export interface CreatePaymentOrderRequest {
  productCode: PaymentProductCode;
}

export interface CreatePaymentOrderResponse {
  id: string;
  provider: "wechat";
  providerOrderId: string;
  productCode: PaymentProductCode;
  amount: number;
  currency: string;
  status: "pending";
  clientPayParams: WeChatAppPayParams;
  reused: boolean;
}
