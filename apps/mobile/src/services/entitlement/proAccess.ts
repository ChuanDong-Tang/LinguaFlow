import { getSession } from "../auth/authStorage";
import type { CurrentEntitlement } from "../api/meApi";
import { getCachedEntitlementForUser } from "./entitlementCache";

// 数据同步/练习写库的 Pro 判断必须优先走本地缓存，避免普通用户为了判断权限也访问云端。
export async function hasLocalProAccess(): Promise<boolean> {
  const session = await getSession();
  if (session?.sessionFlags?.isPro === true) return true;
  if (!session?.user.id) return false;
  const cached = await getCachedEntitlementForUser(session.user.id);
  return cached?.data.isMember === true || cached?.data.isPro === true;
}

export async function hasLocalFeatureAccess(
  feature: keyof NonNullable<CurrentEntitlement["features"]>
): Promise<boolean> {
  const session = await getSession();
  if (!session?.user.id) return session?.sessionFlags?.isPro === true;
  const cached = await getCachedEntitlementForUser(session.user.id);
  const entitlement = cached?.data;
  if (!entitlement) return session.sessionFlags?.isPro === true;
  return entitlement.features?.[feature] ?? entitlement.isMember ?? entitlement.isPro;
}
