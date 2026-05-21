import type { ChatMessage } from "../../domain/chat/types";
import { clampMessages, updateMessageByLocalId } from "../../domain/chat/messageState";
import { loadLocalMessagesScoped, saveLocalMessagesScoped } from "./chatLocalStorage";
import { runChatGeneration } from "./chatGenerationService";
import { getSession } from "../auth/authStorage";
import type { AutoCopyMode } from "../preferences/assistantPreferences";

type ChatSessionSnapshot = {
  isSending: boolean;
  isAnySessionSending: boolean;
  activeContactId: string | null;
  conversationId: string | null;
  activeAssistantLocalId: string | null;
  messages: ChatMessage[];
};

type ChatSessionSubscriber = (snapshot: ChatSessionSnapshot) => void;
type ChatGenerationActivitySubscriber = (snapshot: { isSending: boolean; activeContactId: string | null }) => void;

type StartChatSessionInput = {
  contactId: string;
  text: string;
  assistantLocalId: string;
  retryCount: number;
  systemPrompt?: string;
  userLocalId?: string;
  conversationId?: string | null;
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  onSuccessText?: (text: string, mode: AutoCopyMode) => Promise<void>;
};

type ChatSessionState = {
  messagesCache: ChatMessage[] | null;
  isSending: boolean;
  conversationId: string | null;
  activeAssistantLocalId: string | null;
  activeAbortController: AbortController | null;
  stopRequested: boolean;
  activeRunId: number;
  storageUserId: string | null;
  storageConversationId: string | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Set<ChatSessionSubscriber>;
};

const sessions = new Map<string, ChatSessionState>();
const activitySubscribers = new Set<ChatGenerationActivitySubscriber>();
let activeContactId: string | null = null;

function getSessionState(contactId: string): ChatSessionState {
  const existing = sessions.get(contactId);
  if (existing) return existing;
  const created: ChatSessionState = {
    messagesCache: null,
    isSending: false,
    conversationId: null,
    activeAssistantLocalId: null,
    activeAbortController: null,
    stopRequested: false,
    activeRunId: 0,
    storageUserId: null,
    storageConversationId: null,
    persistTimer: null,
    subscribers: new Set(),
  };
  sessions.set(contactId, created);
  return created;
}

function fallbackConversationScope(contactId: string): string {
  return `contact:${contactId}`;
}

export function subscribeChatSession(contactId: string, subscriber: ChatSessionSubscriber): () => void {
  const state = getSessionState(contactId);
  state.subscribers.add(subscriber);
  subscriber(getSnapshot(state));
  return () => {
    state.subscribers.delete(subscriber);
  };
}

export function subscribeChatGenerationActivity(subscriber: ChatGenerationActivitySubscriber): () => void {
  activitySubscribers.add(subscriber);
  subscriber(getActivitySnapshot());
  return () => {
    activitySubscribers.delete(subscriber);
  };
}

export async function ensureChatMessagesLoaded(contactId: string): Promise<ChatMessage[]> {
  const state = getSessionState(contactId);
  const session = await getSession();
  const uid = session?.user?.id ?? "mock_user_001";
  const cid = state.conversationId ?? fallbackConversationScope(contactId);
  state.storageUserId = uid;
  state.storageConversationId = cid;
  if (state.messagesCache) return state.messagesCache;
  state.messagesCache = await loadLocalMessagesScoped(uid, cid);
  emit(state);
  return state.messagesCache;
}

export async function replaceChatMessages(contactId: string, rows: ChatMessage[]): Promise<void> {
  const state = getSessionState(contactId);
  state.messagesCache = rows;
  const session = await getSession();
  const uid = state.storageUserId ?? session?.user?.id ?? "mock_user_001";
  const cid = state.storageConversationId ?? state.conversationId ?? fallbackConversationScope(contactId);
  state.storageUserId = uid;
  state.storageConversationId = cid;
  await saveLocalMessagesScoped(uid, cid, rows);
  emit(state);
}

export async function appendChatMessages(contactId: string, rows: ChatMessage[]): Promise<ChatMessage[]> {
  const state = getSessionState(contactId);
  const prev = await ensureChatMessagesLoaded(contactId);
  const next = clampMessages([...prev, ...rows], 10000);
  state.messagesCache = next;
  const session = await getSession();
  const uid = state.storageUserId ?? session?.user?.id ?? "mock_user_001";
  const cid = state.storageConversationId ?? state.conversationId ?? fallbackConversationScope(contactId);
  state.storageUserId = uid;
  state.storageConversationId = cid;
  await saveLocalMessagesScoped(uid, cid, next);
  emit(state);
  return next;
}

export function updateChatMessage(
  contactId: string,
  localId: string,
  updater: (message: ChatMessage) => ChatMessage,
): void {
  const state = getSessionState(contactId);
  if (!state.messagesCache) {
    void ensureChatMessagesLoaded(contactId).then(() => updateChatMessage(contactId, localId, updater));
    return;
  }

  const next = updateMessageByLocalId(state.messagesCache, localId, updater);
  state.messagesCache = next;
  schedulePersist(contactId);
  emit(state);
}

function schedulePersist(contactId: string, delayMs = 180): void {
  const state = getSessionState(contactId);
  if (state.persistTimer) clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    void flushPersist(contactId);
  }, delayMs);
}

async function flushPersist(contactId: string): Promise<void> {
  const state = getSessionState(contactId);
  if (!state.messagesCache) return;
  const snapshot = state.messagesCache;
  const session = await getSession();
  const uid = state.storageUserId ?? session?.user?.id ?? "mock_user_001";
  const cid = state.storageConversationId ?? state.conversationId ?? fallbackConversationScope(contactId);
  await saveLocalMessagesScoped(uid, cid, snapshot);
}

export function stopChatSession(contactId: string): void {
  const state = getSessionState(contactId);
  if (!state.activeAbortController || !state.activeAssistantLocalId) return;
  state.stopRequested = true;
  state.activeAbortController.abort();
  void flushPersist(contactId);
  emit(state);
}

export function startChatSession(input: StartChatSessionInput): void {
  const state = getSessionState(input.contactId);
  if (activeContactId && activeContactId !== input.contactId) return;
  if (state.isSending) return;

  const abortController = new AbortController();
  const runId = state.activeRunId + 1;
  state.activeRunId = runId;
  state.isSending = true;
  activeContactId = input.contactId;
  state.activeAbortController = abortController;
  state.activeAssistantLocalId = input.assistantLocalId;
  state.stopRequested = false;
  if (input.conversationId) state.conversationId = input.conversationId;
  if (state.conversationId) {
    const currentConversationId = state.conversationId;
    void (async () => {
      const session = await getSession();
      state.storageUserId = session?.user?.id ?? "mock_user_001";
      state.storageConversationId = currentConversationId;
      if (!state.messagesCache || state.messagesCache.length === 0) {
        state.messagesCache = await loadLocalMessagesScoped(state.storageUserId, state.storageConversationId);
      }
      emit(state);
    })();
  }
  emit(state);
  emitActivity();

  void (async () => {
    const result = await runChatGeneration({
      contactId: input.contactId,
      text: input.text,
      assistantLocalId: input.assistantLocalId,
      retryCount: input.retryCount,
      signal: abortController.signal,
      systemPrompt: input.systemPrompt,
      userLocalId: input.userLocalId,
      isStopRequested: () => state.stopRequested,
      onConversationReady: (nextConversationId) => {
        state.conversationId = nextConversationId;
        state.storageConversationId = nextConversationId;
        emit(state);
      },
      onUpdateMessage: (localId, updater) => {
        updateChatMessage(input.contactId, localId, updater);
      },
    });

    if (result.status === "success" && input.autoCopyAfterGeneration && result.assistantText) {
      await input.onSuccessText?.(result.assistantText, input.autoCopyMode);
    }

    if (state.activeRunId !== runId) return;
    await flushPersist(input.contactId);
    state.isSending = false;
    state.activeAbortController = null;
    state.activeAssistantLocalId = null;
    state.stopRequested = false;
    if (activeContactId === input.contactId) activeContactId = null;
    emit(state);
    emitActivity();
  })();
}

function getSnapshot(state: ChatSessionState): ChatSessionSnapshot {
  return {
    isSending: state.isSending,
    isAnySessionSending: activeContactId !== null,
    activeContactId,
    conversationId: state.conversationId,
    activeAssistantLocalId: state.activeAssistantLocalId,
    messages: state.messagesCache ?? [],
  };
}

function emit(state: ChatSessionState): void {
  const snapshot = getSnapshot(state);
  for (const subscriber of state.subscribers) {
    subscriber(snapshot);
  }
}

function emitActivity(): void {
  const snapshot = getActivitySnapshot();
  sessions.forEach((state) => emit(state));
  for (const subscriber of activitySubscribers) {
    subscriber(snapshot);
  }
}

function getActivitySnapshot(): { isSending: boolean; activeContactId: string | null } {
  return {
    isSending: activeContactId !== null,
    activeContactId,
  };
}
