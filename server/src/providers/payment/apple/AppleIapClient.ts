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
  if (getRuntimeConfig().mode === "test") {
    return fetchTransactionInfoFromEndpoint({
      endpoint: "sandbox",
      baseUrl: APPLE_SANDBOX_BASE_URL,
      transactionId,
      token,
      rootCaPem,
    });
  }

  const prod = await requestTransactionInfo(APPLE_PROD_BASE_URL, transactionId, token);
  if (prod.ok) {
    const verified = verifyAndDecodeAppleJws(prod.signedTransactionInfo, rootCaPem);
    const transaction = decodeTransactionPayload(verified.payload);
    assertAppleTransactionEnvironment(transaction.signedEnvironment, "production");
    return {
      environment: "production",
      ...transaction,
    };
  }

  if (prod.status !== 404) {
    throw new AppleIapVerifyError(
      `Apple production verify failed: HTTP ${prod.status}`,
      `APPLE_PRODUCTION_HTTP_${prod.status}`,
      {
        endpoint: "production",
        status: prod.status,
        responseBody: truncateForLog(prod.message),
      }
    );
  }

  const sandbox = await requestTransactionInfo(APPLE_SANDBOX_BASE_URL, transactionId, token);
  if (!sandbox.ok) {
    throw new AppleIapVerifyError(
      `Apple sandbox verify failed: HTTP ${sandbox.status}`,
      `APPLE_SANDBOX_HTTP_${sandbox.status}`,
      {
        endpoint: "sandbox",
        status: sandbox.status,
        responseBody: truncateForLog(sandbox.message),
      }
    );
  }

  const verified = verifyAndDecodeAppleJws(sandbox.signedTransactionInfo, rootCaPem);
  const transaction = decodeTransactionPayload(verified.payload);
  assertAppleTransactionEnvironment(transaction.signedEnvironment, "sandbox");
  return {
    environment: "sandbox",
    ...transaction,
  };
}

async function fetchTransactionInfoFromEndpoint(input: {
  endpoint: "production" | "sandbox";
  baseUrl: string;
  transactionId: string;
  token: string;
  rootCaPem: string;
}): Promise<{ environment: "production" | "sandbox" } & AppleTransactionPayload> {
  const response = await requestTransactionInfo(input.baseUrl, input.transactionId, input.token);
  if (!response.ok) {
    throw new AppleIapVerifyError(
      `Apple ${input.endpoint} verify failed: HTTP ${response.status}`,
      `APPLE_${input.endpoint.toUpperCase()}_HTTP_${response.status}`,
      {
        endpoint: input.endpoint,
        status: response.status,
        responseBody: truncateForLog(response.message),
      }
    );
  }

  const verified = verifyAndDecodeAppleJws(response.signedTransactionInfo, input.rootCaPem);
  const transaction = decodeTransactionPayload(verified.payload);
  assertAppleTransactionEnvironment(transaction.signedEnvironment, input.endpoint);
  return {
    environment: input.endpoint,
    ...transaction,
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
