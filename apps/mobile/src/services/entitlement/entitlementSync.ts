import { getSession, setSession } from "../auth/authStorage";
import { getCachedEntitlement, isSameEntitlement, setCachedEntitlement } from "./entitlementCache";
import { getCurrentEntitlement, type CurrentEntitlement } from "../api/meApi";

export type RefreshEntitlementResult = {
  entitlement: CurrentEntitlement;
  changed: boolean;
};

// 强制刷新权益的唯一入口：支付成功/登录/恢复支付后要同时更新 cache 和 sessionFlags。
export async function refreshEntitlementAndSession(): Promise<RefreshEntitlementResult> {
  const entitlement = await getCurrentEntitlement();
  const cached = await getCachedEntitlement();
  const changed = !cached || !isSameEntitlement(cached.data, entitlement);
  if (changed) {
    await setCachedEntitlement(entitlement);
  }

  const session = await getSession();
  if (session) {
    await setSession({
      ...session,
      sessionFlags: {
        ...(session.sessionFlags ?? {}),
        isPro: entitlement.isPro,
      },
    });
  }

  return { entitlement, changed };
}

export async function refreshEntitlementAndSessionSafe(): Promise<RefreshEntitlementResult | null> {
  try {
    return await refreshEntitlementAndSession();
  } catch {
    return null;
  }
}
