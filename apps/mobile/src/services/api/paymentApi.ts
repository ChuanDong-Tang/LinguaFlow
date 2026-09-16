import { getAuthHeaders } from "../auth/authHeaders";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { CurrentEntitlement, UsageV2 } from "./meApi";

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
export type MobilePaymentProductCode =
  | "plus_monthly"
  | "plus_yearly"
  | "pro_monthly"
  | "pro_yearly";
export type MobilePaymentTier = "plus" | "pro";
export type MobilePaymentBillingPeriod = "month" | "year";

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
  pendingProductCode: MobilePaymentProductCode | null;
  pendingChangeStatus: "pending_confirmation" | "scheduled" | null;
  pendingChangeEffectiveAt: string | null;
  pendingChangeRequestedAt: string | null;
  managementUrl: string | null;
};

export type MobilePaymentCatalogProduct = {
  productCode: MobilePaymentProductCode;
  tier: MobilePaymentTier;
  billingPeriod: MobilePaymentBillingPeriod;
  alipay: {
    configured: boolean;
    amount: number | null;
    currency: "CNY";
    displayPrice: string | null;
  };
  apple: { productId: string | null };
  googlePlay: { productId: string | null; basePlanId: string | null };
};

export type MobilePlanChangeResult = {
  provider: MobileAutoRenewSubscription["provider"];
  targetProductCode: MobilePaymentProductCode;
  timing: "immediate" | "period_end";
  effectiveAt: string | null;
  jumpSchema?: string | null;
  appleProductId?: string | null;
  googlePlayProductId?: string | null;
  googlePlayBasePlanId?: string | null;
  googlePlayReplacementMode?: "CHARGE_PRORATED_PRICE" | "DEFERRED" | null;
  googlePlayPurchaseToken?: string | null;
  googlePlayOldProductId?: string | null;
};

export type MobileAlipayAutoRenewCreateResult = {
  autoRenewSubscriptionId: string;
  provider: "alipay";
  jumpSchema: string;
  reused: boolean;
};

export type MobileAlipayAutoRenewResumeResult = Pick<
  MobileAutoRenewSubscription,
  "id" | "provider" | "status" | "cancelAtPeriodEnd"
> & { jumpSchema: string };

export type MobileAppleVerifyTransactionResult = {
  transactionId: string;
  productId: string;
  productCode: MobilePaymentProductCode;
  purchaseKind: "single_purchase" | "auto_renew";
  autoRenewSubscriptionId?: string | null;
  alreadyApplied?: boolean;
  ownershipTransferred?: boolean;
  state?: MobileVerifiedPaymentState | null;
};

export type MobileGooglePlayVerifyPurchaseResult = {
  purchaseToken: string;
  productId: string;
  productCode: MobilePaymentProductCode;
  purchaseKind: "auto_renew";
  autoRenewSubscriptionId?: string | null;
  alreadyApplied?: boolean;
  acknowledgementPending?: boolean;
  ownershipTransferred?: boolean;
  state?: MobileVerifiedPaymentState | null;
};

export type MobileVerifiedPaymentState = {
  entitlement: CurrentEntitlement;
  usage: UsageV2;
  autoRenewSubscription: MobileAutoRenewSubscription | null;
};

export async function getProMonthlyProductQuote(): Promise<MobilePaymentProductQuote> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/products/pro-monthly`, {
    headers: await getAuthHeaders(),
  });
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

export async function getPaymentProducts(): Promise<MobilePaymentCatalogProduct[]> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/products`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<{ products: MobilePaymentCatalogProduct[] }>;
  if (!json.ok) throw new MobileApiError(json.error.code, json.error.message);
  return json.data.products;
}

export async function changeAutoRenewPlan(input: {
  autoRenewSubscriptionId: string;
  targetProductCode: MobilePaymentProductCode;
}): Promise<MobilePlanChangeResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/change-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResult<MobilePlanChangeResult>;
  if (!json.ok) throw new MobileApiError(json.error.code, json.error.message);
  return json.data;
}

export async function abandonAutoRenewPlanChange(input: {
  autoRenewSubscriptionId: string;
  targetProductCode: MobilePaymentProductCode;
}): Promise<void> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/change-plan/abandon`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResult<{ status: string }>;
  if (!json.ok) throw new MobileApiError(json.error.code, json.error.message);
}

export async function getCurrentAutoRenewSubscription(timeoutMs = 15_000): Promise<MobileAutoRenewSubscription | null> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/current`, {
    headers: await getAuthHeaders(),
  }, timeoutMs);
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

export async function resumeAlipayAutoRenewSubscription(
  autoRenewSubscriptionId: string
): Promise<MobileAlipayAutoRenewResumeResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/autorenew/resume`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ autoRenewSubscriptionId }),
  });
  const json = (await res.json()) as ApiResult<MobileAlipayAutoRenewResumeResult>;
  if (!json.ok) {
    throw new MobileApiError(json.error.code, json.error.message);
  }
  return json.data;
}

export async function verifyAppleProMonthlyTransaction(
  transactionId: string,
  options?: { allowAccountTransfer?: boolean },
): Promise<MobileAppleVerifyTransactionResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/payment/ios/verify-transaction`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({
      transactionId,
      ...(options?.allowAccountTransfer ? { allowAccountTransfer: true } : {}),
    }),
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
  allowAccountTransfer?: boolean;
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
