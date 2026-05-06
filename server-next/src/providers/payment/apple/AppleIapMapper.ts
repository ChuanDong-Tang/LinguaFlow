import { AppleIapVerifyError } from "./AppleIapErrors.js";

export type AppleTransactionPayload = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
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

  if (!transactionId || !bundleId || !productId) {
    throw new AppleIapVerifyError("Transaction payload missing required fields");
  }

  return {
    transactionId,
    originalTransactionId,
    bundleId,
    productId,
  };
}
