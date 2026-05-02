import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatMessage } from "../screens/chat/types";

const CHAT_LOCAL_KEY = "lf_chat_local_messages_v1";

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

export async function saveLocalMessages(rows: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(CHAT_LOCAL_KEY, JSON.stringify(rows));
}

export async function appendLocalMessages(newRows: ChatMessage[]): Promise<ChatMessage[]> {
  const prev = await loadLocalMessages();
  const next = [...prev, ...newRows];
  await saveLocalMessages(next);
  return next;
}

