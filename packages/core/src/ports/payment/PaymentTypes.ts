/** PaymentTypes：定义支付领域通用类型（状态、渠道、请求响应、错误码）。 */

export type PaymentProviderName = "wechat" | "apple_iap";

export type PaymentOrderStatus = "pending" | "paid" | "closed" | "failed" | "refunded";

export type PaymentProductCode = "plus_monthly" | "pro_monthly";

export interface WeChatAppPayParams {
  appId: string;
  partnerId: string;
  prepayId: string;
  packageValue: "Sign=WXPay";
  nonceStr: string;
  timeStamp: string;
  sign: string;
}

export interface CreateProviderOrderInput {
  providerOrderId: string;
  userId: string;
  productCode: PaymentProductCode;
  description: string;
  amount: number;
  currency: "CNY";
  notifyUrl: string;
}

export interface CreateProviderOrderResult {
  provider: PaymentProviderName;
  providerOrderId: string;
  clientPayParams: WeChatAppPayParams;
  raw: unknown;
}

export interface QueryProviderOrderInput {
  providerOrderId: string;
}

export interface QueryProviderOrderResult {
  provider: PaymentProviderName;
  providerOrderId: string;
  status: PaymentOrderStatus;
  raw: unknown;
}
