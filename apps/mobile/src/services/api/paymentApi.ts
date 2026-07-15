import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export class MobileApiError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type MobilePaymentOrderStatus = "pending" | "paid" | "closed" | "failed" | "refunded";
export type MobilePaymentProductCode = "plus_monthly" | "pro_monthly";

export type MobileCreatePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: MobilePaymentProductCode;
  amount: number;
  currency: "CNY";
  status: "pending";
  reused: boolean;
  clientPayParams: Record<string, unknown>;
};

export type MobilePaymentProductQuote = {
  productCode: MobilePaymentProductCode;
  amount: number;
  currency: "CNY";
  displayPrice: string;
};

export type MobilePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: MobilePaymentProductCode;
  amount: number;
  currency: "CNY";
  status: MobilePaymentOrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type MobileAutoRenewSubscription = {
  id: string;
  provider: "wechat" | "apple" | "google_play";
  productCode: MobilePaymentProductCode;
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
  productCode: MobilePaymentProductCode;
  purchaseKind: "single_purchase" | "auto_renew";
  autoRenewSubscriptionId?: string | null;
  alreadyApplied?: boolean;
};

export type MobileGooglePlayVerifyPurchaseResult = {
  purchaseToken: string;
  productId: string;
  productCode: MobilePaymentProductCode;
  purchaseKind: "auto_renew";
  autoRenewSubscriptionId?: string | null;
  alreadyApplied?: boolean;
  acknowledgementPending?: boolean;
};

export async function createMembershipMonthlyOrder(productCode: MobilePaymentProductCode): Promise<MobileCreatePaymentOrderResult> {
  const res = await fetch(`${BASE_URL}/payment/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ productCode }),
  });
  const json = (await res.json()) as ApiResult<MobileCreatePaymentOrderResult>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function createProMonthlyOrder(): Promise<MobileCreatePaymentOrderResult> {
  return createMembershipMonthlyOrder("pro_monthly");
}

export async function getProMonthlyProductQuote(): Promise<MobilePaymentProductQuote> {
  const res = await fetch(`${BASE_URL}/payment/products/pro-monthly`);
  const json = (await res.json()) as ApiResult<MobilePaymentProductQuote>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function getPlusMonthlyProductQuote(): Promise<MobilePaymentProductQuote> {
  const res = await fetch(`${BASE_URL}/payment/products/plus-monthly`);
  const json = (await res.json()) as ApiResult<MobilePaymentProductQuote>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function queryPaymentOrder(orderId: string): Promise<MobilePaymentOrderResult> {
  const res = await fetch(`${BASE_URL}/payment/orders/${encodeURIComponent(orderId)}`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<MobilePaymentOrderResult>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function getCurrentAutoRenewSubscription(): Promise<MobileAutoRenewSubscription | null> {
  const res = await fetch(`${BASE_URL}/payment/autorenew/current`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<{ subscription: MobileAutoRenewSubscription | null }>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data.subscription;
}

export async function createWeChatAutoRenewPreSign(
  productCode: MobilePaymentProductCode
): Promise<MobileWeChatAutoRenewPreSignResult> {
  const res = await fetch(`${BASE_URL}/payment/autorenew/wechat/pre-sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ productCode }),
  });
  const json = (await res.json()) as ApiResult<MobileWeChatAutoRenewPreSignResult>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
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
    throw new MobileApiError(json.error.code, json.error.message);
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
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function verifyGooglePlaySubscriptionPurchase(input: {
  productId: string;
  purchaseToken: string;
  obfuscatedAccountId?: string | null;
}): Promise<MobileGooglePlayVerifyPurchaseResult> {
  const res = await fetch(`${BASE_URL}/payment/google-play/verify-purchase`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResult<MobileGooglePlayVerifyPurchaseResult>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function registerGooglePlayObfuscatedAccountId(obfuscatedAccountId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/payment/google-play/account-link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ obfuscatedAccountId }),
  });
  const json = (await res.json()) as ApiResult<{ obfuscatedAccountId: string }>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
}

export async function registerAppleAppAccountToken(appAccountToken: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/payment/ios/app-account-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ appAccountToken }),
  });
  const json = (await res.json()) as ApiResult<{ appAccountToken: string }>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
}
