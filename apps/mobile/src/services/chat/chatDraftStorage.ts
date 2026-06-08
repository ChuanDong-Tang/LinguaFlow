import AsyncStorage from "@react-native-async-storage/async-storage";

const CHAT_DRAFT_PREFIX = "lf_chat_input_draft_v1";
const MAX_DRAFT_LENGTH = 10000;

function draftKey(contactId: string): string {
  return `${CHAT_DRAFT_PREFIX}:${contactId}`;
}

export async function loadChatInputDraft(contactId: string): Promise<string> {
  const raw = await AsyncStorage.getItem(draftKey(contactId));
  return raw ?? "";
}

export async function saveChatInputDraft(contactId: string, text: string): Promise<void> {
  const normalized = text.length > MAX_DRAFT_LENGTH ? text.slice(0, MAX_DRAFT_LENGTH) : text;
  if (normalized.length === 0) {
    await clearChatInputDraft(contactId);
    return;
  }
  await AsyncStorage.setItem(draftKey(contactId), normalized);
}

export async function clearChatInputDraft(contactId: string): Promise<void> {
  await AsyncStorage.removeItem(draftKey(contactId));
}
