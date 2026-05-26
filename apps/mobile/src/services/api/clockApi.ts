const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const CLOCK_REQUEST_TIMEOUT_MS = 3000;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type BusinessClock = {
  serverNowIso: string;
  businessTimeZone: string;
  businessDateKey: string;
};

export async function getBusinessClock(): Promise<BusinessClock> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLOCK_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/clock`, { signal: controller.signal });
    const json = (await res.json()) as ApiResult<BusinessClock>;
    if (!json.ok) {
      throw new Error(json.error.message);
    }
    return json.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("clock request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
