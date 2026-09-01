import { getAuthHeaders } from "../auth/authHeaders";
import { fetchWithTimeout } from "./fetchWithTimeout";

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

export type MobilePaymentProductQuote = {
  productCode: MobilePaymentProductCode;
  amount: number | null;
  currency: "CNY";
  displayPrice: string | null;
  monthlyTokenLimit: number;
  monthlyImageUploadBytes: number;
};

export type MobilePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: MobilePaymentProductCode;
  amount: number;
  currency: string;
  status: MobilePaymentOrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type MobileAutoRenewSubscription = {
  id: string;
  provider: "alipay" | "apple" | "google_play";
  productCode: MobilePaymentProductCode;
  status: "pending" | "active" | "cancelled" | "expired" | "billing_retry" | "paused";
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
};

export type MobileAlipayAutoRenewCreateResult = {
  autoRenewSubscriptionId: string;
  provider: "alipay";
  jumpSchema: string;
  reused: boolean;
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

export async function getProMonthlyProductQuote(): Promise<MobilePaymentProductQuote> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/products/pro-monthly`);
  const json = (await res.json()) as ApiResult<MobilePaymentProductQuote>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function getPlusMonthlyProductQuote(): Promise<MobilePaymentProductQuote> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/products/plus-monthly`);
  const json = (await res.json()) as ApiResult<MobilePaymentProductQuote>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function getCurrentAutoRenewSubscription(): Promise<MobileAutoRenewSubscription | null> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/current`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<{ subscription: MobileAutoRenewSubscription | null }>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data.subscription;
}

export async function createAlipayAutoRenewSubscription(
  productCode: MobilePaymentProductCode
): Promise<MobileAlipayAutoRenewCreateResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/alipay/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ productCode }),
  });
  const json = (await res.json()) as ApiResult<MobileAlipayAutoRenewCreateResult>;
  if (!json.ok && "error" in json) throw new MobileApiError(json.error.code, json.error.message);
  return json.data;
}

export async function cancelAutoRenewSubscription(
  autoRenewSubscriptionId: string
): Promise<Pick<MobileAutoRenewSubscription, "id" | "provider" | "status" | "cancelledAt" | "cancelAtPeriodEnd">> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ autoRenewSubscriptionId }),
  });
  const json = (await res.json()) as ApiResult<Pick<
    MobileAutoRenewSubscription,
    "id" | "provider" | "status" | "cancelledAt" | "cancelAtPeriodEnd"
  >>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function verifyAppleProMonthlyTransaction(
  transactionId: string
): Promise<MobileAppleVerifyTransactionResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/ios/verify-transaction`, {
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
  const res = await fetchWithTimeout(`${BASE_URL}/payment/google-play/verify-purchase`, {
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
  const res = await fetchWithTimeout(`${BASE_URL}/payment/google-play/account-link`, {
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
  const res = await fetchWithTimeout(`${BASE_URL}/payment/ios/app-account-token`, {
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
