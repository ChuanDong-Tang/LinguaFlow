import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CurrentEntitlement } from "../api/meApi";
import { environmentStorageKey } from "../storage/environmentStorageKey";

const ENTITLEMENT_CACHE_KEY = environmentStorageKey("lf_current_entitlement_v1");

export type CachedEntitlement = {
  data: CurrentEntitlement;
  cachedAt: number;
};

export async function getCachedEntitlement(): Promise<CachedEntitlement | null> {
  const raw = await AsyncStorage.getItem(ENTITLEMENT_CACHE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CachedEntitlement;
  } catch {
    await AsyncStorage.removeItem(ENTITLEMENT_CACHE_KEY);
    return null;
  }
}

export async function getCachedEntitlementForUser(userId: string): Promise<CachedEntitlement | null> {
  const cached = await getCachedEntitlement();
  return cached?.data.userId === userId ? cached : null;
}

export async function setCachedEntitlement(data: CurrentEntitlement): Promise<void> {
  await AsyncStorage.setItem(
    ENTITLEMENT_CACHE_KEY,
    JSON.stringify({
      data,
      cachedAt: Date.now(),
    })
  );
}

export async function clearCachedEntitlement(): Promise<void> {
  await AsyncStorage.removeItem(ENTITLEMENT_CACHE_KEY);
}

export function isSameEntitlement(a: CurrentEntitlement | null, b: CurrentEntitlement): boolean {
  if (!a) return false;

  return (
    a.userId === b.userId &&
    a.plan === b.plan &&
    a.tier === b.tier &&
    a.isPro === b.isPro &&
    a.isPlus === b.isPlus &&
    a.isMember === b.isMember &&
    a.expiresAt === b.expiresAt &&
    a.dateKey === b.dateKey &&
    a.dailyTotalLimit === b.dailyTotalLimit &&
    a.usedTotalChars === b.usedTotalChars &&
    a.remainingChars === b.remainingChars
  );
}
