export interface AlipaySubscriptionSnapshot {
  subscription_id: string;
  subscription_status?: string;
  customer_id?: string;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  canceled_date?: string;
  items?: Array<{
    price?: {
      id?: string;
      product_id?: string;
      unit_amount?: string | number;
    };
  }>;
}

export interface AlipaySubscriptionQueryResponse {
  subscriptions?: AlipaySubscriptionSnapshot[];
}

export interface AlipayPriceSnapshot {
  id: string;
  active: boolean;
  productId: string | null;
  unitAmount: number;
  type: string | null;
  recurring: {
    interval: string | null;
    intervalCount: number | null;
  } | null;
}

export type AlipaySubscriptionStatus =
  | "INCOMPLETE"
  | "ACTIVE"
  | "CANCELED"
  | "INCOMPLETE_EXPIRED";

export interface AlipaySubscriptionChanged {
  notifyId: string;
  appId: string;
  changeType: "active" | "period_extend" | "cancel" | "cancel_at_period_end" | "trialing" | "item_update" | "item_downgrade" | "item_cancel_revert";
  changeDate: string | null;
  tradeNo: string | null;
  orderNo: string | null;
  outTradeNo: string | null;
  payAmount: number | null;
  subscription: AlipaySubscriptionSnapshot;
  raw: Record<string, string>;
}
