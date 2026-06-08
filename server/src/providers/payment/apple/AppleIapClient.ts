import { APPLE_PROD_BASE_URL, APPLE_SANDBOX_BASE_URL } from "./AppleIapConstants.js";
import { AppleIapVerifyError } from "./AppleIapErrors.js";
import { verifyAndDecodeAppleJws } from "./AppleIapJws.js";
import type { AppleTransactionPayload } from "./AppleIapMapper.js";
import { decodeTransactionPayload } from "./AppleIapMapper.js";
import { getRuntimeConfig } from "../../../config/runtimeConfig.js";

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
  if (prod.status !== 404) throw prod.error;
  if (!runtime.payment.appleIap.allowSandboxFallback) throw prod.error;

  // App Store Server API 对 sandbox/TestFlight 交易常见表现是 production 查不到返回 404。
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

function truncateForLog(value: string, maxLength = 500): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
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
