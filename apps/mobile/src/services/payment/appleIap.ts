import { Platform } from "react-native";
import type { Purchase } from "expo-iap";
import * as Crypto from "expo-crypto";

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

export async function createAppleAppAccountToken(userId: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `linguaflow:${userId}`
  );
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") +
      hash.slice(18, 20),
    hash.slice(20, 32),
  ].join("-");
}
