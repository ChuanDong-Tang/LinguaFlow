import AsyncStorage from "@react-native-async-storage/async-storage";

const CHAT_DRAFT_PREFIX = "lf_chat_input_draft_v1";
const MAX_DRAFT_LENGTH = 10000;
const draftWriteQueues = new Map<string, Promise<void>>();

function draftKey(contactId: string): string {
  return `${CHAT_DRAFT_PREFIX}:${contactId}`;
}

export async function loadChatInputDraft(contactId: string): Promise<string> {
  const key = draftKey(contactId);
  await draftWriteQueues.get(key)?.catch(() => {});
  const raw = await AsyncStorage.getItem(key);
  return raw ?? "";
}

export async function saveChatInputDraft(contactId: string, text: string): Promise<void> {
  const normalized = text.length > MAX_DRAFT_LENGTH ? text.slice(0, MAX_DRAFT_LENGTH) : text;
  if (normalized.length === 0) {
    await clearChatInputDraft(contactId);
    return;
  }
  await enqueueDraftWrite(contactId, (key) => AsyncStorage.setItem(key, normalized));
}

export async function clearChatInputDraft(contactId: string): Promise<void> {
  await enqueueDraftWrite(contactId, (key) => AsyncStorage.removeItem(key));
}

function enqueueDraftWrite(contactId: string, write: (key: string) => Promise<void>): Promise<void> {
  const key = draftKey(contactId);
  const previous = draftWriteQueues.get(key) ?? Promise.resolve();
  const queued = previous.catch(() => {}).then(() => write(key));
  const tracked = queued.catch(() => {});
  draftWriteQueues.set(key, tracked);
  void tracked.finally(() => {
    if (draftWriteQueues.get(key) === tracked) {
      draftWriteQueues.delete(key);
    }
  });
  return queued;
}
