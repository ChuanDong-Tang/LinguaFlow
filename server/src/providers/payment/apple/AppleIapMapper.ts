import { AppleIapVerifyError } from "./AppleIapErrors.js";

export type AppleTransactionPayload = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  signedEnvironment: string | null;
  appAccountToken: string | null;
  purchaseDate: number | null;
  expiresDate: number | null;
};

export type AppleServerNotificationPayload = {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string;
  data?: {
    environment?: string;
    signedTransactionInfo?: string;
  };
};

export type AppleRenewalInfoPayload = {
  autoRenewStatus: number | null;
  productId: string | null;
  autoRenewProductId: string | null;
  originalTransactionId: string | null;
  signedEnvironment: string | null;
};

export function decodeTransactionPayload(payload: Record<string, unknown>): AppleTransactionPayload {
  const transactionId = String(payload.transactionId ?? "").trim();
  const originalTransactionId = String(payload.originalTransactionId ?? "").trim();
  const bundleId = String(payload.bundleId ?? "").trim();
  const productId = String(payload.productId ?? "").trim();
  const signedEnvironment = readNullableString(payload.environment);
  const appAccountToken = readNullableString(payload.appAccountToken);
  const purchaseDate = readNullableNumber(payload.purchaseDate);
  const expiresDate = readNullableNumber(payload.expiresDate);

  if (!transactionId || !bundleId || !productId) {
    throw new AppleIapVerifyError("Transaction payload missing required fields");
  }

  return {
    transactionId,
    originalTransactionId,
    bundleId,
    productId,
    signedEnvironment,
    appAccountToken,
    purchaseDate,
    expiresDate,
  };
}

export function decodeRenewalInfoPayload(payload: Record<string, unknown>): AppleRenewalInfoPayload {
  return {
    autoRenewStatus: readNullableNumber(payload.autoRenewStatus),
    productId: readNullableString(payload.productId),
    autoRenewProductId: readNullableString(payload.autoRenewProductId),
    originalTransactionId: readNullableString(payload.originalTransactionId),
    signedEnvironment: readNullableString(payload.environment),
  };
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
