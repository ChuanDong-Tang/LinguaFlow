import { Platform } from "react-native";
import type { Purchase } from "expo-iap";

export const APPLE_PRO_MONTHLY_PRODUCT_ID =
  process.env.EXPO_PUBLIC_APPLE_PRO_MONTHLY_PRODUCT_ID || "pro_monthly";

export function assertAppleIapAvailable(): void {
  if (Platform.OS !== "ios") {
    throw new Error("当前平台不支持 Apple IAP");
  }
  if (!APPLE_PRO_MONTHLY_PRODUCT_ID) {
    throw new Error("Apple IAP 商品 ID 未配置");
  }
}

export function getAppleTransactionId(purchase: Purchase): string {
  const transactionId = String(purchase.transactionId ?? purchase.id ?? "").trim();
  if (!transactionId) {
    throw new Error("Apple 交易 ID 为空，无法验单");
  }
  return transactionId;
}
