import AsyncStorage from "@react-native-async-storage/async-storage";
import { refreshEntitlementAndSessionSafe } from "../entitlement/entitlementSync";
import {
  queryPaymentOrder,
  type MobilePaymentOrderResult,
  type MobilePaymentOrderStatus,
} from "../api/paymentApi";

const PENDING_PAYMENT_ORDER_KEY = "lf_pending_payment_order_v1";

type PendingPaymentOrder = {
  orderId: string;
  providerOrderId: string;
  createdAt: string;
};

type PollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  maxConsecutiveErrors?: number;
};

export async function savePendingPaymentOrder(input: {
  orderId: string;
  providerOrderId: string;
}): Promise<void> {
  const data: PendingPaymentOrder = {
    orderId: input.orderId,
    providerOrderId: input.providerOrderId,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_PAYMENT_ORDER_KEY, JSON.stringify(data));
}

export async function clearPendingPaymentOrder(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
}

export async function getPendingPaymentOrder(): Promise<PendingPaymentOrder | null> {
  const raw = await AsyncStorage.getItem(PENDING_PAYMENT_ORDER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingPaymentOrder;
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

function isSuccessfulStatus(status: MobilePaymentOrderStatus): boolean {
  return status === "paid";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
