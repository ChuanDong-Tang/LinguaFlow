import { Platform } from "react-native";
import type { Purchase } from "expo-iap";
import * as Crypto from "expo-crypto";
import { t } from "../../i18n";
import type { MobilePaymentProductCode } from "../api/paymentApi";

export const APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID =
  process.env.EXPO_PUBLIC_APPLE_PLUS_MONTHLY_PRODUCT_ID || "plus_monthly";

export const APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID =
  process.env.EXPO_PUBLIC_APPLE_PRO_MONTHLY_PRODUCT_ID || "pro_monthly";

export const APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID =
  process.env.EXPO_PUBLIC_APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID ||
  "pro_monthly_one_time";

export type ApplePurchaseSource = "single_purchase" | "auto_renew";

export function getAppleProductIdForSource(
  source: ApplePurchaseSource,
  productCode: MobilePaymentProductCode = "pro_monthly",
): string {
  if (source === "auto_renew" && productCode === "plus_monthly") {
    return APPLE_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID;
  }
  return source === "single_purchase"
    ? APPLE_PRO_MONTHLY_ONE_TIME_PRODUCT_ID
    : APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID;
}

export function assertAppleIapAvailable(
  source?: ApplePurchaseSource,
  productCode: MobilePaymentProductCode = "pro_monthly",
): void {
  if (Platform.OS !== "ios") {
    throw new Error(t("payment.apple.unsupported"));
  }
  const productId = source
    ? getAppleProductIdForSource(source, productCode)
    : APPLE_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID;
  if (!productId) {
    throw new Error(t("payment.apple.product_missing"));
  }
}

export function getAppleTransactionId(purchase: Purchase): string {
  const transactionId = String(
    purchase.transactionId ?? purchase.id ?? "",
  ).trim();
  if (!transactionId) {
    throw new Error(t("payment.apple.transaction_missing"));
  }
  return transactionId;
}

export async function createAppleAppAccountToken(
  userId: string,
): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `oio:${userId}`,
  );
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0") + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}
