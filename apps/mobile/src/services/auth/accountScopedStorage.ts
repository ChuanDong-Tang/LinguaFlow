import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearCachedEntitlement } from "../entitlement/entitlementCache";
import { environmentStorageKey } from "../storage/environmentStorageKey";

const AUTO_RENEW_CACHE_KEY = environmentStorageKey("lf_current_auto_renew_v1");
const PENDING_PAYMENT_ORDER_KEY = environmentStorageKey("lf_pending_payment_order_v1");
const PENDING_AUTO_RENEW_FLOW_KEY = environmentStorageKey("lf_pending_auto_renew_flow_v1");

export async function clearAccountScopedStorage(): Promise<void> {
  await Promise.all([
    clearCachedEntitlement(),
    AsyncStorage.removeItem(AUTO_RENEW_CACHE_KEY),
    AsyncStorage.removeItem(PENDING_PAYMENT_ORDER_KEY),
    AsyncStorage.removeItem(PENDING_AUTO_RENEW_FLOW_KEY),
  ]);
}
