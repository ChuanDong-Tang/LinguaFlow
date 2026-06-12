import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSession } from "../auth/authStorage";
import { refreshEntitlementAndSessionSafe } from "../entitlement/entitlementSync";
import {
  getCurrentAutoRenewSubscription,
  queryPaymentOrder,
  type MobileAutoRenewSubscription,
  type MobilePaymentOrderResult,
  type MobilePaymentOrderStatus,
} from "../api/paymentApi";
import { environmentStorageKey } from "../storage/environmentStorageKey";

const PENDING_PAYMENT_ORDER_KEY = environmentStorageKey("lf_pending_payment_order_v1");
const PENDING_AUTO_RENEW_FLOW_KEY = environmentStorageKey("lf_pending_auto_renew_flow_v1");

type PendingPaymentOrder = {
  userId: string;
  orderId: string;
  providerOrderId: string;
  createdAt: string;
};

type PollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  maxConsecutiveErrors?: number;
};

type PendingAutoRenewFlow = {
  userId: string;
  autoRenewSubscriptionId: string;
  provider: "wechat" | "apple";
  providerOrderId: string | null;
  createdAt: string;
};

export async function savePendingPaymentOrder(input: {
  orderId: string;
  providerOrderId: string;
}): Promise<void> {
  const session = await getSession();
  if (!session?.user.id) return;
  const data: PendingPaymentOrder = {
    userId: session.user.id,
    orderId: input.orderId,
    providerOrderId: input.providerOrderId,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_PAYMENT_ORDER_KEY, JSON.stringify(data));
}

export async function clearPendingPaymentOrder(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
}

export async function savePendingAutoRenewFlow(input: {
  autoRenewSubscriptionId: string;
  provider: "wechat" | "apple";
  providerOrderId: string | null;
}): Promise<void> {
  const session = await getSession();
  if (!session?.user.id) return;
  const data: PendingAutoRenewFlow = {
    userId: session.user.id,
    autoRenewSubscriptionId: input.autoRenewSubscriptionId,
    provider: input.provider,
    providerOrderId: input.providerOrderId,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_AUTO_RENEW_FLOW_KEY, JSON.stringify(data));
}

export async function clearPendingAutoRenewFlow(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_AUTO_RENEW_FLOW_KEY);
}

export async function clearPendingPaymentRecoveryState(): Promise<void> {
  await Promise.all([clearPendingPaymentOrder(), clearPendingAutoRenewFlow()]);
}

export async function getPendingAutoRenewFlow(): Promise<PendingAutoRenewFlow | null> {
  const raw = await AsyncStorage.getItem(PENDING_AUTO_RENEW_FLOW_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingAutoRenewFlow;
    return (await isPendingStateForCurrentUser(pending.userId)) ? pending : null;
  } catch {
    await AsyncStorage.removeItem(PENDING_AUTO_RENEW_FLOW_KEY);
    return null;
  }
}

export async function getPendingPaymentOrder(): Promise<PendingPaymentOrder | null> {
  const raw = await AsyncStorage.getItem(PENDING_PAYMENT_ORDER_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingPaymentOrder;
    return (await isPendingStateForCurrentUser(pending.userId)) ? pending : null;
  } catch {
    await AsyncStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
    return null;
  }
}

export async function pollPaymentOrderUntilSettled(
  orderId: string,
  options: PollOptions = {}
): Promise<MobilePaymentOrderResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_500;
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? 3;
  const startedAt = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const order = await queryPaymentOrder(orderId);
      consecutiveErrors = 0;
      if (order.status !== "pending") {
        if (isSuccessfulStatus(order.status)) {
          await refreshEntitlementAndSessionSafe();
        }
        return order;
      }
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw error;
      }
    }

    await sleep(intervalMs);
  }

  return {
    id: orderId,
    provider: "unknown",
    providerOrderId: "unknown",
    productCode: "pro_monthly",
    amount: 0,
    currency: "CNY",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function recoverPendingPaymentIfAny(): Promise<{
  recovered: boolean;
  status: MobilePaymentOrderStatus | null;
}> {
  const pending = await getPendingPaymentOrder();
  if (!pending) return { recovered: false, status: null };

  try {
    const result = await pollPaymentOrderUntilSettled(pending.orderId, {
      timeoutMs: 30_000,
      intervalMs: 3_000,
      maxConsecutiveErrors: 2,
    });

    if (result.status !== "pending") {
      await clearPendingPaymentOrder();
      return { recovered: true, status: result.status };
    }

    return { recovered: false, status: "pending" };
  } catch {
    return { recovered: false, status: "pending" };
  }
}

export async function recoverPendingAutoRenewIfAny(): Promise<{
  recovered: boolean;
  subscription: MobileAutoRenewSubscription | null;
  entitlementIsPro: boolean | null;
}> {
  const pending = await getPendingAutoRenewFlow();
  if (!pending) return { recovered: false, subscription: null, entitlementIsPro: null };

  try {
    const [subscription, entitlementResult] = await Promise.all([
      getCurrentAutoRenewSubscription(),
      refreshEntitlementAndSessionSafe(),
    ]);

    const matched =
      subscription?.id === pending.autoRenewSubscriptionId ||
      Boolean(subscription && subscription.provider === pending.provider);
    const entitlementIsPro = entitlementResult?.entitlement.isPro ?? null;

    if (matched || entitlementIsPro === true) {
      await clearPendingAutoRenewFlow();
      return { recovered: true, subscription, entitlementIsPro };
    }

    return { recovered: false, subscription, entitlementIsPro };
  } catch {
    return { recovered: false, subscription: null, entitlementIsPro: null };
  }
}

function isSuccessfulStatus(status: MobilePaymentOrderStatus): boolean {
  return status === "paid";
}

async function isPendingStateForCurrentUser(userId: unknown): Promise<boolean> {
  if (typeof userId !== "string" || !userId) return false;
  const session = await getSession();
  return session?.user.id === userId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
