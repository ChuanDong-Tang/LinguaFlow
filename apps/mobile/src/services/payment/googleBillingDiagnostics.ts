import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { sanitizeGoogleBillingDiagnostic } from "@lf/core/payment/googleBillingDiagnostics";
import { getAuthHeaders } from "../auth/authHeaders";
import { fetchWithTimeout } from "../api/fetchWithTimeout";

let windowStart = 0;
let reports = 0;
/** Best effort only: diagnostics must never block or retry a purchase. */
export async function reportGoogleBillingError(error: unknown, stage: "request" | "callback" | "products", productId?: string): Promise<void> {
  try {
    if (Platform.OS !== "android" || process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL === "china") return;
    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; reports = 0; }
    if (reports >= 5) return;
    reports++;
    const e = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
    const selectedProduct = productId ?? (typeof e.productId === "string" ? e.productId : undefined);
    const basePlanId = selectedProduct === (process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_MONTHLY_PRODUCT_ID || "plus_monthly")
      ? process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_MONTHLY_BASE_PLAN_ID
      : selectedProduct === (process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID || "pro_monthly")
        ? process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_MONTHLY_BASE_PLAN_ID
        : selectedProduct === (process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_YEARLY_PRODUCT_ID || "plus_yearly")
          ? process.env.EXPO_PUBLIC_GOOGLE_PLAY_PLUS_YEARLY_BASE_PLAN_ID
          : selectedProduct === (process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_YEARLY_PRODUCT_ID || "pro_yearly")
            ? process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_YEARLY_BASE_PLAN_ID : undefined;
    const body = sanitizeGoogleBillingDiagnostic({
      stage, code: e.code, responseCode: e.responseCode, subResponseCode: e.subResponseCode,
      message: e.message, debugMessage: e.debugMessage, productId: selectedProduct, basePlanId,
      appVersion: Application.nativeApplicationVersion, buildNumber: Application.nativeBuildVersion,
      runtimeVersion: Updates.runtimeVersion, updateId: Updates.updateId, channel: Updates.channel,
    });
    const headers = await getAuthHeaders();
    await fetchWithTimeout(`${process.env.EXPO_PUBLIC_API_BASE_URL}/payment/google-play/client-error`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }, 5000);
  } catch { /* Offline, old API or logging failure must not alter payment UI. */ }
}
