import type { PracticeDayStats } from "../../domain/practice/practiceService";

const PRACTICE_STATS_TTL_MS = 5 * 60 * 1000;

type PracticeMonthCacheEntry = {
  stats: PracticeDayStats[];
  fetchedAt: number;
};

const practiceMonthStatsCache = new Map<string, PracticeMonthCacheEntry>();
const dirtyPracticeDateKeys = new Set<string>();
const dirtyChatDateKeysByContact = new Map<string, Set<string>>();

export function getPracticeMonthCacheKey(monthKey: string, contactIds: string[]): string {
  return `${contactIds.slice().sort().join(",")}:${monthKey}`;
}

export function getCachedPracticeMonthStats(cacheKey: string, monthKey: string): PracticeDayStats[] | null {
  const cached = practiceMonthStatsCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > PRACTICE_STATS_TTL_MS) return null;
  if (hasDirtyPracticeDateInMonth(monthKey)) return null;
  return cached.stats;
}

export function setCachedPracticeMonthStats(cacheKey: string, stats: PracticeDayStats[]): void {
  practiceMonthStatsCache.set(cacheKey, {
    stats,
    fetchedAt: Date.now(),
  });
}

export function markPracticeStatsDirty(dateKey: string): void {
  dirtyPracticeDateKeys.add(dateKey);
}

export function clearPracticeStatsDirtyForMonth(monthKey: string): void {
  for (const dateKey of Array.from(dirtyPracticeDateKeys)) {
    if (dateKey.startsWith(`${monthKey}-`)) dirtyPracticeDateKeys.delete(dateKey);
  }
}

export function markChatDateDirty(contactId: string, dateKey: string): void {
  const keys = dirtyChatDateKeysByContact.get(contactId) ?? new Set<string>();
  keys.add(dateKey);
  dirtyChatDateKeysByContact.set(contactId, keys);
}

export function consumeChatDateDirty(contactId: string, dateKey: string): boolean {
  const keys = dirtyChatDateKeysByContact.get(contactId);
  if (!keys?.has(dateKey)) return false;
  keys.delete(dateKey);
  if (!keys.size) dirtyChatDateKeysByContact.delete(contactId);
  return true;
}

function hasDirtyPracticeDateInMonth(monthKey: string): boolean {
  for (const dateKey of dirtyPracticeDateKeys) {
    if (dateKey.startsWith(`${monthKey}-`)) return true;
  }
  return false;
}
