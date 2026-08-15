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

// 仅供服务端同样以 entitlement.isPro 严格校验的能力使用；Plus 不能在这里视为 Pro。
export async function hasLocalStrictProAccess(): Promise<boolean> {
  const session = await getSession();
  if (session?.sessionFlags?.isPro === true) return true;
  if (!session?.user.id) return false;
  const cached = await getCachedEntitlementForUser(session.user.id);
  return cached?.data.isPro === true || cached?.data.tier === "pro";
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
