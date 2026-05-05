import { getAuthHeaders } from "./authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type CurrentEntitlement = {
  userId: string;
  plan: "free" | "pro_monthly";
  isPro: boolean;
  expiresAt: string | null;
  dateKey: string;
  dailyTotalLimit: number;
  usedTotalChars: number;
  remainingChars: number;
  source?: "authing" | "mock";
};

export async function getCurrentEntitlement(): Promise<CurrentEntitlement> {
  const res = await fetch(`${BASE_URL}/me/entitlement`, {
    headers: await getAuthHeaders(),
  });

  const json = (await res.json()) as ApiResult<CurrentEntitlement>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}
