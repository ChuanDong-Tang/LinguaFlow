import { getAuthHeaders } from "./authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type MobilePaymentOrderStatus = "pending" | "paid" | "closed" | "failed" | "refunded";

export type MobileCreatePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: "pro_monthly";
  amount: number;
  currency: "CNY";
  status: "pending";
  reused: boolean;
  clientPayParams: Record<string, unknown>;
};

export type MobilePaymentOrderResult = {
  id: string;
  provider: string;
  providerOrderId: string;
  productCode: "pro_monthly";
  amount: number;
  currency: "CNY";
  status: MobilePaymentOrderStatus;
  createdAt: string;
  updatedAt: string;
};

export async function createProMonthlyOrder(): Promise<MobileCreatePaymentOrderResult> {
  const res = await fetch(`${BASE_URL}/payment/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ productCode: "pro_monthly" }),
  });
  const json = (await res.json()) as ApiResult<MobileCreatePaymentOrderResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function queryPaymentOrder(orderId: string): Promise<MobilePaymentOrderResult> {
  const res = await fetch(`${BASE_URL}/payment/orders/${encodeURIComponent(orderId)}`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json()) as ApiResult<MobilePaymentOrderResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}
