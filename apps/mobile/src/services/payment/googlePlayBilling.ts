import { Platform } from "react-native";
import type { ProductSubscription, Purchase } from "expo-iap";
import * as Crypto from "expo-crypto";
import { t } from "../../i18n";
import type { MobilePaymentProductCode } from "../api/paymentApi";

export const GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID || "plus_monthly";

export const GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID || "pro_monthly";

const GOOGLE_PLAY_PLUS_MONTHLY_BASE_PLAN_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_MONTHLY_BASE_PLAN_ID || "";
const GOOGLE_PLAY_PRO_MONTHLY_BASE_PLAN_ID =
  process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_MONTHLY_BASE_PLAN_ID || "";

export function getGooglePlayProductId(productCode: MobilePaymentProductCode = "pro_monthly"): string {
  return productCode === "plus_monthly"
    ? GOOGLE_PLAY_PLUS_MONTHLY_SUBSCRIPTION_PRODUCT_ID
    : GOOGLE_PLAY_PRO_MONTHLY_SUBSCRIPTION_PRODUCT_ID;
}

export function assertGooglePlayBillingAvailable(productCode: MobilePaymentProductCode = "pro_monthly"): void {
  if (Platform.OS !== "android") {
    throw new Error(t("pro.alert.unsupported_purchase"));
  }
  if (!getGooglePlayProductId(productCode)) {
    throw new Error(t("payment.apple.product_missing"));
  }
}

export function getGooglePlayPurchaseToken(purchase: Purchase): string {
  const purchaseToken = String(purchase.purchaseToken ?? "").trim();
  if (!purchaseToken) {
    throw new Error("Google Play purchase token missing");
  }
  return purchaseToken;
}

export async function createGooglePlayObfuscatedAccountId(userId: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `oio:${userId}`
  );
  return `oio_${hash.slice(0, 32)}`;
}

export function getGooglePlayBasePlanOfferToken(
  product: ProductSubscription | undefined,
  productCode: MobilePaymentProductCode = "pro_monthly"
): string | null {
  const productWithAndroidOffers = product as { subscriptionOfferDetailsAndroid?: unknown } | undefined;
  const offers = readArray<Record<string, unknown>>(productWithAndroidOffers?.subscriptionOfferDetailsAndroid);
  const expectedBasePlanId =
    productCode === "plus_monthly" ? GOOGLE_PLAY_PLUS_MONTHLY_BASE_PLAN_ID : GOOGLE_PLAY_PRO_MONTHLY_BASE_PLAN_ID;
  if (!expectedBasePlanId) return null;

  // Promo codes are redeemed by Google Play inside its checkout UI. Start the
  // plain base plan here instead of binding the app to a developer-defined offer.
  const matchedOffer = offers.find((offer) => {
    if (typeof offer.offerToken !== "string" || !offer.offerToken.trim()) return false;
    if (offer.basePlanId !== expectedBasePlanId) return false;
    return offer.offerId == null || (typeof offer.offerId === "string" && !offer.offerId.trim());
  });
  return typeof matchedOffer?.offerToken === "string" ? matchedOffer.offerToken.trim() : null;
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
