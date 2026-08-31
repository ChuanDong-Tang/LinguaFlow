/** PaymentTypes：定义支付领域通用类型（状态、渠道、请求响应、错误码）。 */

export type PaymentProviderName = "apple_iap" | "google_play_iap";

export type PaymentOrderStatus = "pending" | "paid" | "closed" | "failed" | "refunded";

export type PaymentProductCode = "plus_monthly" | "pro_monthly";
