import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "../../domain/chat/types";
import { compareChatMessagesByCreatedAt, getMessageDateKey, toDateKey } from "../../domain/chat/messageState";

const CHAT_LOCAL_SCOPE_PREFIX = "lf_chat_local_messages_v3";
const CHAT_LOCAL_DAYS_SCOPE_PREFIX = "lf_chat_local_days_v3";

function messagesDayKey(userId: string, conversationId: string, dateKey: string): string {
  return `${CHAT_LOCAL_SCOPE_PREFIX}:${userId}:${conversationId}:${dateKey}`;
}

function daysIndexKey(userId: string, conversationId: string): string {
  return `${CHAT_LOCAL_DAYS_SCOPE_PREFIX}:${userId}:${conversationId}`;
}

function sortByCreatedAt(rows: ChatMessage[]): ChatMessage[] {
  return rows.slice().sort(compareChatMessagesByCreatedAt);
}

function uniqueSortedDays(days: Iterable<string>): string[] {
  return Array.from(new Set(days)).sort((a, b) => (a < b ? -1 : 1));
}

async function getIndexedDays(userId: string, conversationId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(daysIndexKey(userId, conversationId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return uniqueSortedDays(parsed.filter((value): value is string => typeof value === "string" && value.length > 0));
  } catch {
    return [];
  }
}

async function setIndexedDays(userId: string, conversationId: string, days: string[]): Promise<void> {
  await AsyncStorage.setItem(daysIndexKey(userId, conversationId), JSON.stringify(uniqueSortedDays(days)));
}

async function ensureDaysIncluded(userId: string, conversationId: string, days: string[]): Promise<void> {
  if (!days.length) return;
  const existing = await getIndexedDays(userId, conversationId);
  const merged = uniqueSortedDays([...existing, ...days]);
  await setIndexedDays(userId, conversationId, merged);
}

function normalizeRows(rows: ChatMessage[]): ChatMessage[] {
  return rows.map((row) => {
    const conversationDateKey = row.conversationDateKey ?? toDateKey(new Date(row.createdAt));
    return { ...row, conversationDateKey };
  });
}

export async function listLocalMessageDateKeysScoped(userId: string, conversationId: string): Promise<string[]> {
  return getIndexedDays(userId, conversationId);
}

export async function loadLocalMessagesByDateScoped(
  userId: string,
  conversationId: string,
  dateKey: string
): Promise<ChatMessage[]> {
  const raw = await AsyncStorage.getItem(messagesDayKey(userId, conversationId, dateKey));
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(rows)) return [];

    const normalized = normalizeRows(rows).map((row, index) => {
      const legacyBase = row.id ?? String(index);
      const clientId = row.clientId ?? row.localId ?? `legacy-${legacyBase}`;
      const localId = row.localId ?? row.clientId ?? `legacy-${legacyBase}`;
      const serverId = row.serverId ?? row.id ?? null;
      return {
        ...row,
        clientId,
        localId,
        serverId,
      };
    });
    return sortByCreatedAt(normalized);
  } catch {
    return [];
  }
}

export async function saveLocalMessagesByDateScoped(
  userId: string,
  conversationId: string,
  dateKey: string,
  rows: ChatMessage[]
): Promise<void> {
  const normalized = sortByCreatedAt(
    normalizeRows(rows).map((row) => ({ ...row, conversationDateKey: row.conversationDateKey ?? dateKey }))
  );
  await AsyncStorage.setItem(messagesDayKey(userId, conversationId, dateKey), JSON.stringify(normalized));
  await ensureDaysIncluded(userId, conversationId, [dateKey]);
}

export async function removeLocalMessagesByDateScoped(
  userId: string,
  conversationId: string,
  dateKey: string
): Promise<void> {
  await AsyncStorage.removeItem(messagesDayKey(userId, conversationId, dateKey));
  const existing = await getIndexedDays(userId, conversationId);
  if (!existing.includes(dateKey)) return;
  await setIndexedDays(
    userId,
    conversationId,
    existing.filter((day) => day !== dateKey)
  );
}
