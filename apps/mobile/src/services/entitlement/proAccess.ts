import { getSession } from "../auth/authStorage";
import { getCachedEntitlement } from "./entitlementCache";

// 数据同步/练习写库的 Pro 判断必须优先走本地缓存，避免普通用户为了判断权限也访问云端。
export async function hasLocalProAccess(): Promise<boolean> {
  const session = await getSession();
  if (session?.sessionFlags?.isPro === true) return true;
  const cached = await getCachedEntitlement();
  return cached?.data.isPro === true;
}
