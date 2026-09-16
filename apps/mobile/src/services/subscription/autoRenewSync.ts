import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getSession } from "../auth/authStorage";
import {
  getCurrentAutoRenewSubscription,
  type MobileAutoRenewSubscription,
} from "../api/paymentApi";
import { refreshEntitlementAndSessionSafe } from "../entitlement/entitlementSync";
import { environmentStorageKey } from "../storage/environmentStorageKey";

const AUTO_RENEW_CACHE_KEY = environmentStorageKey("lf_current_auto_renew_v1");
const AUTO_RENEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedAutoRenewSubscription = {
  userId: string;
  platform: typeof Platform.OS;
  subscription: MobileAutoRenewSubscription | null;
  cachedAt: number;
};

const activeSyncs = new Map<string, Promise<MobileAutoRenewSubscription | null>>();

export async function reconcileMembershipSilently(
  timeoutMs = 8_000,
): Promise<MobileAutoRenewSubscription | null> {
  const session = await getSession();
  if (!session?.user.id) return null;
  const userId = session.user.id;
  const existing = activeSyncs.get(userId);
  if (existing) return existing;
  const sync = (async () => {
    const subscription = await getCurrentAutoRenewSubscription(timeoutMs);
    const currentSession = await getSession();
    if (currentSession?.user.id !== userId) return null;
    await saveCachedAutoRenewSubscription(userId, subscription);
    // Provider reconciliation may have applied an immediate upgrade or an
    // expired renewal. Refresh entitlement only after that provider truth is
    // persisted; failures stay silent and never block normal app startup.
    await refreshEntitlementAndSessionSafe();
    return subscription;
  })();
  activeSyncs.set(userId, sync);
  try {
    return await sync;
  } finally {
    if (activeSyncs.get(userId) === sync) activeSyncs.delete(userId);
  }
}

export async function loadCachedAutoRenewSubscription(
  userId: string,
): Promise<MobileAutoRenewSubscription | null> {
  const raw = await AsyncStorage.getItem(AUTO_RENEW_CACHE_KEY);
  if (!raw) return null;

  try {
    const cached = JSON.parse(raw) as Partial<CachedAutoRenewSubscription>;
    const isFresh =
      typeof cached.cachedAt === "number" &&
      Date.now() - cached.cachedAt <= AUTO_RENEW_CACHE_TTL_MS;
    if (
      !isFresh ||
      cached.userId !== userId ||
      cached.platform !== Platform.OS ||
      !isValidCachedAutoRenewSubscription(cached.subscription)
    ) {
      return null;
    }
    return cached.subscription;
  } catch {
    await AsyncStorage.removeItem(AUTO_RENEW_CACHE_KEY);
    return null;
  }
}

export async function saveCachedAutoRenewSubscriptionForCurrentUser(
  subscription: MobileAutoRenewSubscription | null,
): Promise<void> {
  const session = await getSession();
  if (!session?.user.id) return;
  await saveCachedAutoRenewSubscription(session.user.id, subscription);
}

async function saveCachedAutoRenewSubscription(
  userId: string,
  subscription: MobileAutoRenewSubscription | null,
): Promise<void> {
  const cached: CachedAutoRenewSubscription = {
    userId,
    platform: Platform.OS,
    subscription,
    cachedAt: Date.now(),
  };
  await AsyncStorage.setItem(AUTO_RENEW_CACHE_KEY, JSON.stringify(cached));
}

function isValidCachedAutoRenewSubscription(
  value: unknown,
): value is MobileAutoRenewSubscription | null {
  if (value === null) return true;
  if (typeof value !== "object" || !value) return false;
  const candidate = value as Partial<MobileAutoRenewSubscription>;
  return (
    typeof candidate.id === "string" &&
    (candidate.provider === "apple" ||
      candidate.provider === "alipay" ||
      candidate.provider === "google_play") &&
    (["plus_monthly", "plus_yearly", "pro_monthly", "pro_yearly"] as string[]).includes(
      String(candidate.productCode),
    ) &&
    typeof candidate.status === "string"
  );
}
