import { APPLE_PROD_BASE_URL, APPLE_SANDBOX_BASE_URL } from "./AppleIapConstants.js";
import { AppleIapVerifyError } from "./AppleIapErrors.js";
import { verifyAndDecodeAppleJws } from "./AppleIapJws.js";
import type { AppleRenewalInfoPayload, AppleTransactionPayload } from "./AppleIapMapper.js";
import { decodeRenewalInfoPayload, decodeTransactionPayload } from "./AppleIapMapper.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";

export type AppleSubscriptionStatus = {
  status: number | null;
  transaction: AppleTransactionPayload | null;
  renewalInfo: AppleRenewalInfoPayload | null;
};

export async function fetchTransactionInfo(
  transactionId: string,
  token: string,
  rootCaPem: string
): Promise<
  { environment: "production" | "sandbox" } & AppleTransactionPayload
> {
  const runtime = getRuntimeConfig();
  if (runtime.mode === "test") {
    const sandbox = await fetchTransactionInfoFromEndpoint({
      endpoint: "sandbox",
      baseUrl: APPLE_SANDBOX_BASE_URL,
      transactionId,
      token,
      rootCaPem,
    });
    if (sandbox.ok) return sandbox.transaction;
    throw sandbox.error;
  }

  const prod = await fetchTransactionInfoFromEndpoint({
    endpoint: "production",
    baseUrl: APPLE_PROD_BASE_URL,
    transactionId,
    token,
    rootCaPem,
  });
  if (prod.ok) return prod.transaction;
  if (!shouldFallbackToSandbox(prod.status)) throw prod.error;
  if (!runtime.payment.appleIap.allowSandboxFallback) throw prod.error;

  // App Store Server API 对 sandbox/TestFlight 交易常见表现是 production 查不到返回 404；
  // Apple 有时也会在 production endpoint 对 sandbox 交易返回 401。
  // 只有显式允许 fallback 时才查 sandbox，避免正式生产环境无意接受沙盒票据。
  const sandbox = await fetchTransactionInfoFromEndpoint({
    endpoint: "sandbox",
    baseUrl: APPLE_SANDBOX_BASE_URL,
    transactionId,
    token,
    rootCaPem,
  });
  if (sandbox.ok) return sandbox.transaction;
  throw sandbox.error;
}

export async function fetchSubscriptionStatuses(
  originalTransactionId: string,
  token: string,
  rootCaPem: string
): Promise<{ environment: "production" | "sandbox"; statuses: AppleSubscriptionStatus[] }> {
  const runtime = getRuntimeConfig();
  if (runtime.mode === "test") {
    const sandbox = await fetchSubscriptionStatusesFromEndpoint({
      endpoint: "sandbox",
      baseUrl: APPLE_SANDBOX_BASE_URL,
      originalTransactionId,
      token,
      rootCaPem,
    });
    if (sandbox.ok) return sandbox.result;
    throw sandbox.error;
  }

  const prod = await fetchSubscriptionStatusesFromEndpoint({
    endpoint: "production",
    baseUrl: APPLE_PROD_BASE_URL,
    originalTransactionId,
    token,
    rootCaPem,
  });
  if (prod.ok) return prod.result;
  if (!shouldFallbackToSandbox(prod.status)) throw prod.error;
  if (!runtime.payment.appleIap.allowSandboxFallback) throw prod.error;

  const sandbox = await fetchSubscriptionStatusesFromEndpoint({
    endpoint: "sandbox",
    baseUrl: APPLE_SANDBOX_BASE_URL,
    originalTransactionId,
    token,
    rootCaPem,
  });
  if (sandbox.ok) return sandbox.result;
  throw sandbox.error;
}

export async function setAppAccountToken(
  input: {
    environment: "production" | "sandbox";
    originalTransactionId: string;
    appAccountToken: string;
  },
  token: string
): Promise<void> {
  const baseUrl = input.environment === "sandbox" ? APPLE_SANDBOX_BASE_URL : APPLE_PROD_BASE_URL;
  const response = await requestSetAppAccountToken({
    baseUrl,
    originalTransactionId: input.originalTransactionId,
    appAccountToken: input.appAccountToken,
    token,
  });
  if (response.ok) return;

  throw new AppleIapVerifyError(
    `Apple ${input.environment} appAccountToken update failed: HTTP ${response.status}`,
    `APPLE_${input.environment.toUpperCase()}_APP_ACCOUNT_TOKEN_HTTP_${response.status}`,
    {
      endpoint: input.environment,
      status: response.status,
      responseBody: truncateForLog(response.message),
      originalTransactionId: input.originalTransactionId,
    }
  );
}

async function fetchTransactionInfoFromEndpoint(input: {
  endpoint: "production" | "sandbox";
  baseUrl: string;
  transactionId: string;
  token: string;
  rootCaPem: string;
}): Promise<
  | { ok: true; transaction: { environment: "production" | "sandbox" } & AppleTransactionPayload }
  | { ok: false; status: number; error: AppleIapVerifyError }
> {
  const response = await requestTransactionInfo(input.baseUrl, input.transactionId, input.token);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: new AppleIapVerifyError(
        `Apple ${input.endpoint} verify failed: HTTP ${response.status}`,
        `APPLE_${input.endpoint.toUpperCase()}_HTTP_${response.status}`,
        {
          endpoint: input.endpoint,
          status: response.status,
          responseBody: truncateForLog(response.message),
        }
      ),
    };
  }

  const verified = verifyAndDecodeAppleJws(response.signedTransactionInfo, input.rootCaPem);
  const transaction = decodeTransactionPayload(verified.payload);
  assertAppleTransactionEnvironment(transaction.signedEnvironment, input.endpoint);
  return {
    ok: true,
    transaction: {
      environment: input.endpoint,
      ...transaction,
    },
  };
}

async function fetchSubscriptionStatusesFromEndpoint(input: {
  endpoint: "production" | "sandbox";
  baseUrl: string;
  originalTransactionId: string;
  token: string;
  rootCaPem: string;
}): Promise<
  | { ok: true; result: { environment: "production" | "sandbox"; statuses: AppleSubscriptionStatus[] } }
  | { ok: false; status: number; error: AppleIapVerifyError }
> {
  const response = await requestSubscriptionStatuses(
    input.baseUrl,
    input.originalTransactionId,
    input.token
  );
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: new AppleIapVerifyError(
        `Apple ${input.endpoint} subscription status failed: HTTP ${response.status}`,
        `APPLE_${input.endpoint.toUpperCase()}_SUBSCRIPTION_STATUS_HTTP_${response.status}`,
        {
          endpoint: input.endpoint,
          status: response.status,
          responseBody: truncateForLog(response.message),
        }
      ),
    };
  }

  const statuses = response.data.flatMap((group) =>
    group.lastTransactions.map((item) => {
      const transaction = item.signedTransactionInfo
        ? decodeTransactionPayload(
            verifyAndDecodeAppleJws(item.signedTransactionInfo, input.rootCaPem).payload
          )
        : null;
      const renewalInfo = item.signedRenewalInfo
        ? decodeRenewalInfoPayload(
            verifyAndDecodeAppleJws(item.signedRenewalInfo, input.rootCaPem).payload
          )
        : null;
      if (transaction) {
        assertAppleTransactionEnvironment(transaction.signedEnvironment, input.endpoint);
      }
      if (renewalInfo?.signedEnvironment) {
        assertAppleTransactionEnvironment(renewalInfo.signedEnvironment, input.endpoint);
      }
      return {
        status: readNullableNumber(item.status),
        transaction,
        renewalInfo,
      };
    })
  );

  return {
    ok: true,
    result: {
      environment: input.endpoint,
      statuses,
    },
  };
}

function truncateForLog(value: string, maxLength = 500): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function shouldFallbackToSandbox(status: number): boolean {
  return status === 401 || status === 404;
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function requestTransactionInfo(
  baseUrl: string,
  transactionId: string,
  token: string
): Promise<
  | { ok: true; signedTransactionInfo: string }
  | { ok: false; status: number; message: string }
> {
  const response = await fetch(
    `${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return { ok: false, status: response.status, message };
  }

  const payload = (await response.json()) as { signedTransactionInfo?: string };
  const signedTransactionInfo = payload.signedTransactionInfo?.trim();
  if (!signedTransactionInfo) {
    return { ok: false, status: 502, message: "Missing signedTransactionInfo" };
  }

  return { ok: true, signedTransactionInfo };
}

async function requestSubscriptionStatuses(
  baseUrl: string,
  originalTransactionId: string,
  token: string
): Promise<
  | {
      ok: true;
      data: Array<{
        lastTransactions: Array<{
          status?: number | string;
          signedTransactionInfo?: string;
          signedRenewalInfo?: string;
        }>;
      }>;
    }
  | { ok: false; status: number; message: string }
> {
  const response = await fetch(
    `${baseUrl}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return { ok: false, status: response.status, message };
  }

  const payload = (await response.json()) as {
    data?: Array<{
      lastTransactions?: Array<{
        status?: number | string;
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
      }>;
    }>;
  };
  return {
    ok: true,
    data: Array.isArray(payload.data)
      ? payload.data.map((group) => ({
          lastTransactions: Array.isArray(group.lastTransactions)
            ? group.lastTransactions
            : [],
        }))
      : [],
  };
}

async function requestSetAppAccountToken(input: {
  baseUrl: string;
  originalTransactionId: string;
  appAccountToken: string;
  token: string;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const response = await fetch(
    `${input.baseUrl}/inApps/v1/transactions/${encodeURIComponent(input.originalTransactionId)}/appAccountToken`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ appAccountToken: input.appAccountToken }),
    }
  );

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    return { ok: false, status: response.status, message };
  }

  return { ok: true };
}

function assertAppleTransactionEnvironment(
  signedEnvironment: string | null,
  expected: "production" | "sandbox"
): void {
  if (!signedEnvironment) return;
  const normalized = signedEnvironment.trim().toLowerCase();
  if (normalized !== expected) {
    throw new AppleIapVerifyError("Apple transaction environment mismatch");
  }
}
