import { AppleIapVerifyError } from "./AppleIapErrors.js";

export type AppleTransactionPayload = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  appAccountToken: string | null;
  purchaseDate: number | null;
  expiresDate: number | null;
};

export type AppleServerNotificationPayload = {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
  };
};

export function decodeTransactionPayload(payload: Record<string, unknown>): AppleTransactionPayload {
  const transactionId = String(payload.transactionId ?? "").trim();
  const originalTransactionId = String(payload.originalTransactionId ?? "").trim();
  const bundleId = String(payload.bundleId ?? "").trim();
  const productId = String(payload.productId ?? "").trim();
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
    appAccountToken,
    purchaseDate,
    expiresDate,
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
