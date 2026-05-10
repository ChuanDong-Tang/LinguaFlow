import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "../screens/chat/types";

const CHAT_LOCAL_KEY = "lf_chat_local_messages_v1";
const CHAT_LOCAL_SCOPE_PREFIX = "lf_chat_local_messages_v2";

function scopeKey(userId: string, conversationId: string): string {
  return `${CHAT_LOCAL_SCOPE_PREFIX}:${userId}:${conversationId}`;
}

async function migrateLegacyIfNeeded(key: string): Promise<void> {
  const existing = await AsyncStorage.getItem(key);
  if (existing) return;
  const legacy = await AsyncStorage.getItem(CHAT_LOCAL_KEY);
  if (!legacy) return;
  await AsyncStorage.setItem(key, legacy);
}

export async function loadLocalMessages(): Promise<ChatMessage[]> {
  const raw = await AsyncStorage.getItem(CHAT_LOCAL_KEY);
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function loadLocalMessagesScoped(
  userId: string,
  conversationId: string
): Promise<ChatMessage[]> {
  const key = scopeKey(userId, conversationId);
  await migrateLegacyIfNeeded(key);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function saveLocalMessages(rows: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(CHAT_LOCAL_KEY, JSON.stringify(rows));
}

export async function saveLocalMessagesScoped(
  userId: string,
  conversationId: string,
  rows: ChatMessage[]
): Promise<void> {
  await AsyncStorage.setItem(scopeKey(userId, conversationId), JSON.stringify(rows));
}

export async function appendLocalMessages(newRows: ChatMessage[]): Promise<ChatMessage[]> {
  const prev = await loadLocalMessages();
  const next = [...prev, ...newRows];
  await saveLocalMessages(next);
  return next;
}

export async function appendLocalMessagesScoped(
  userId: string,
  conversationId: string,
  newRows: ChatMessage[]
): Promise<ChatMessage[]> {
  const prev = await loadLocalMessagesScoped(userId, conversationId);
  const next = [...prev, ...newRows];
  await saveLocalMessagesScoped(userId, conversationId, next);
  return next;
}
