import { getBusinessClock, type BusinessClock } from "../api/clockApi";

const CLOCK_CACHE_TTL_MS = 60 * 1000;

let cachedClock: {
  fetchedAt: number;
  value: BusinessClock;
} | null = null;

export async function getServerDateKey(): Promise<string> {
  return getBusinessDateKey();
}

export async function getBusinessDateKey(): Promise<string> {
  return (await getCachedBusinessClock()).businessDateKey;
}

export async function getServerNow(): Promise<Date> {
  return new Date((await getCachedBusinessClock()).serverNowIso);
}

export async function getCachedBusinessClock(): Promise<BusinessClock> {
  const now = Date.now();
  if (cachedClock && now - cachedClock.fetchedAt <= CLOCK_CACHE_TTL_MS) {
    return cachedClock.value;
  }

  const value = await getBusinessClock();
  cachedClock = { fetchedAt: now, value };
  return value;
}

export function dateKeyToDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}
