import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type MobilePaymentOrderStatus = "pending" | "paid" | "closed" | "failed" | "refunded";

export type MobileCreatePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: "pro_monthly";
  amount: number;
  currency: "CNY";
  status: "pending";
  reused: boolean;
  clientPayParams: Record<string, unknown>;
};

export type MobilePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: "pro_monthly";
  amount: number;
  currency: "CNY";
  status: MobilePaymentOrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type MobileAutoRenewSubscription = {
  id: string;
  provider: "wechat" | "apple";
  productCode: "pro_monthly";
  status: "pending" | "active" | "cancelled" | "expired" | "billing_retry" | "paused";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelledAt: string | null;
};

export type MobileWeChatAutoRenewPreSignResult = {
  autoRenewSubscriptionId: string;
  provider: "wechat";
  outContractCode: string;
  providerOrderId: string | null;
  clientPayParams: Record<string, unknown> | null;
  redirectUrl: string | null;
};

export type MobileAppleVerifyTransactionResult = {
  transactionId: string;
  productId: string;
  autoRenewSubscriptionId?: string | null;
  alreadyApplied?: boolean;
};

export async function createProMonthlyOrder(): Promise<MobileCreatePaymentOrderResult> {
  const res = await fetch(`${BASE_URL}/payment/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ productCode: "pro_monthly" }),
  });
  const json = (await res.json()) as ApiResult<MobileCreatePaymentOrderResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function queryPaymentOrder(orderId: string): Promise<MobilePaymentOrderResult> {
  const res = await fetch(`${BASE_URL}/payment/orders/${encodeURIComponent(orderId)}`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<MobilePaymentOrderResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function getCurrentAutoRenewSubscription(): Promise<MobileAutoRenewSubscription | null> {
  const res = await fetch(`${BASE_URL}/payment/autorenew/current`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<{ subscription: MobileAutoRenewSubscription | null }>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data.subscription;
}

export async function createWeChatAutoRenewPreSign(): Promise<MobileWeChatAutoRenewPreSignResult> {
  const res = await fetch(`${BASE_URL}/payment/autorenew/wechat/pre-sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ productCode: "pro_monthly" }),
  });
  const json = (await res.json()) as ApiResult<MobileWeChatAutoRenewPreSignResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function cancelAutoRenewSubscription(
  autoRenewSubscriptionId: string
): Promise<Pick<MobileAutoRenewSubscription, "id" | "provider" | "status" | "cancelledAt">> {
  const res = await fetch(`${BASE_URL}/payment/autorenew/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ autoRenewSubscriptionId }),
  });
  const json = (await res.json()) as ApiResult<Pick<
    MobileAutoRenewSubscription,
    "id" | "provider" | "status" | "cancelledAt"
  >>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function verifyAppleProMonthlyTransaction(
  transactionId: string
): Promise<MobileAppleVerifyTransactionResult> {
  const res = await fetch(`${BASE_URL}/payment/ios/verify-transaction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ transactionId }),
  });
  const json = (await res.json()) as ApiResult<MobileAppleVerifyTransactionResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}
