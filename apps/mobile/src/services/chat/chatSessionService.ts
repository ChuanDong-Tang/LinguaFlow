import type { ChatMessage } from "../../domain/chat/types";
import { compareChatMessagesByCreatedAt, getMessageDateKey, updateMessageByClientId } from "../../domain/chat/messageState";
import {
  listLocalMessageDateKeysScoped,
  loadLocalMessagesByDateScoped,
  removeLocalMessagesByDateScoped,
  saveLocalMessagesByDateScoped,
} from "./chatLocalStorage";
import { runChatGeneration } from "./chatGenerationService";
import { updateMessageClozeState } from "../api/chatHistoryApi";
import { getSession } from "../auth/authStorage";
import type { AutoCopyMode } from "../preferences/assistantPreferences";

type ChatSessionSnapshot = {
  isSending: boolean;
  isAnySessionSending: boolean;
  activeContactId: string | null;
  conversationId: string | null;
  activeAssistantClientId: string | null;
  changedDateKey: string | null;
};

type ChatSessionSubscriber = (snapshot: ChatSessionSnapshot) => void;
type ChatGenerationActivitySubscriber = (snapshot: { isSending: boolean; activeContactId: string | null }) => void;

type StartChatSessionInput = {
  contactId: string;
  text: string;
  assistantClientId: string
  userClientId?: string
  conversationDateKey: string;
  retryCount: number;
  companionMode?: "rewrite_only" | "native_note" | "simple_reply";
  systemPrompt?: string;
  conversationId?: string | null;
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  autoClozeAfterGeneration: boolean;
  onSuccessText?: (text: string, mode: AutoCopyMode) => Promise<void>;
  onStreamDone?: () => void;
  onFailure?: (error: { code?: string; message?: string; stage?: "input" | "output" }) => void;
};

type ChatSessionState = {
  dayCache: Map<string, ChatMessage[]>;
  isSending: boolean;
  conversationId: string | null;
  activeAssistantClientId: string | null;
  activeAbortController: AbortController | null;
  stopRequested: boolean;
  activeRunId: number;
  storageUserId: string | null;
  storageConversationId: string | null;
  subscribers: Set<ChatSessionSubscriber>;
};

const sessions = new Map<string, ChatSessionState>();
const activitySubscribers = new Set<ChatGenerationActivitySubscriber>();
let activeContactId: string | null = null;
const MAX_MESSAGES_PER_DAY = 400;
const MAX_STORED_DAYS = 45;

function getSessionState(contactId: string): ChatSessionState {
  const existing = sessions.get(contactId);
  if (existing) return existing;
  const created: ChatSessionState = {
    dayCache: new Map(),
    isSending: false,
    conversationId: null,
    activeAssistantClientId: null,
    activeAbortController: null,
    stopRequested: false,
    activeRunId: 0,
    storageUserId: null,
    storageConversationId: null,
    subscribers: new Set(),
  };
  sessions.set(contactId, created);
  return created;
}

function fallbackConversationScope(contactId: string): string {
  return `contact:${contactId}`;
}

async function resolveStorageScope(contactId: string): Promise<{ state: ChatSessionState; uid: string; cid: string }> {
  const state = getSessionState(contactId);
  const session = await getSession();
  const uid = session?.user?.id ?? "mock_user_001";
  if (state.storageUserId && state.storageUserId !== uid) {
    // 切换账号时模块可能仍在内存中，需要丢弃上一位用户的聊天日缓存。
    state.dayCache.clear();
    state.conversationId = null;
  }
  // 本地缓存按联系人和日期隔离；云端 conversationId 只用于接口请求。
  const cid = fallbackConversationScope(contactId);
  state.storageUserId = uid;
  state.storageConversationId = cid;
  return { state, uid, cid };
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

export function getChatGenerationActivitySnapshot(): { isSending: boolean; activeContactId: string | null } {
  return getActivitySnapshot();
}

export async function listStoredChatDateKeys(contactId: string): Promise<string[]> {
  const { uid, cid } = await resolveStorageScope(contactId);
  return listLocalMessageDateKeysScoped(uid, cid);
}

export async function loadChatMessagesByDate(contactId: string, dateKey: string): Promise<ChatMessage[]> {
  const { state, uid, cid } = await resolveStorageScope(contactId);
  const cached = state.dayCache.get(dateKey);
  if (cached) return cached;
  const rows = await loadLocalMessagesByDateScoped(uid, cid, dateKey);
  state.dayCache.set(dateKey, rows);
  return rows;
}

export async function loadPracticeLocalMessages(contactId: string): Promise<ChatMessage[]> {
  const { uid, cid } = await resolveStorageScope(contactId);
  const fallbackCid = fallbackConversationScope(contactId);
  const scopes = Array.from(new Set([cid, fallbackCid]));
  const rowsByKey = new Map<string, ChatMessage>();

  for (const scope of scopes) {
    const days = await listLocalMessageDateKeysScoped(uid, scope);
    for (const day of days) {
      const rows = await loadLocalMessagesByDateScoped(uid, scope, day);
      for (const row of rows) {
        rowsByKey.set(row.serverId ?? row.clientId ?? row.id ?? row.localId, row);
      }
    }
  }

  return Array.from(rowsByKey.values()).sort(compareChatMessagesByCreatedAt);
}

export async function replaceChatMessagesByDate(
  contactId: string,
  dateKey: string,
  rows: ChatMessage[]
): Promise<void> {
  const { state, uid, cid } = await resolveStorageScope(contactId);
  await saveLocalMessagesByDateScoped(uid, cid, dateKey, rows);
  state.dayCache.set(dateKey, rows);
  emit(state, dateKey);
}

export async function appendChatMessages(contactId: string, rows: ChatMessage[]): Promise<ChatMessage[]> {
  const { state, uid, cid } = await resolveStorageScope(contactId);
  const grouped = new Map<string, ChatMessage[]>();
  for (const row of rows) {
    const key = getMessageDateKey(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  for (const [dateKey, newDayRows] of grouped.entries()) {
    const existing = await loadLocalMessagesByDateScoped(uid, cid, dateKey);
    const nextDay = [...existing, ...newDayRows]
      .sort(compareChatMessagesByCreatedAt)
      .slice(-MAX_MESSAGES_PER_DAY);
    await saveLocalMessagesByDateScoped(uid, cid, dateKey, nextDay);
    state.dayCache.set(dateKey, nextDay);
  }

  const days = await listLocalMessageDateKeysScoped(uid, cid);
  if (days.length > MAX_STORED_DAYS) {
    const removable = days.slice(0, days.length - MAX_STORED_DAYS);
    for (const dateKey of removable) {
      await removeLocalMessagesByDateScoped(uid, cid, dateKey);
      state.dayCache.delete(dateKey);
    }
  }

  const firstTouchedDay = grouped.keys().next().value as string | undefined;
  emit(state, firstTouchedDay ?? null);
  return firstTouchedDay ? (state.dayCache.get(firstTouchedDay) ?? []) : [];
}

export async function updateChatMessage(
  contactId: string,
  clientId: string,
  updater: (message: ChatMessage) => ChatMessage,
  dateKey: string,
): Promise<void> {
  const { state, uid, cid } = await resolveStorageScope(contactId);
  const current = state.dayCache.get(dateKey) ?? await loadLocalMessagesByDateScoped(uid, cid, dateKey);
  const next = updateMessageByClientId(current, clientId, updater);
  state.dayCache.set(dateKey, next);
  await saveLocalMessagesByDateScoped(uid, cid, dateKey, next);
  emit(state, dateKey);
}

export function stopChatSession(contactId: string): void {
  const state = getSessionState(contactId);
  if (!state.activeAbortController || !state.activeAssistantClientId) return;
  state.stopRequested = true;
  state.activeAbortController.abort();
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
  state.activeAssistantClientId = input.assistantClientId;
  state.stopRequested = false;
  if (input.conversationId) state.conversationId = input.conversationId;
  if (state.conversationId) {
    void (async () => {
      const session = await getSession();
      state.storageUserId = session?.user?.id ?? "mock_user_001";
      state.storageConversationId = fallbackConversationScope(input.contactId);
      emit(state);
    })();
  }
  emit(state);
  emitActivity();

  // startChatSession 不等待，启动任务
  void (async () => {
    const result = await runChatGeneration({
      contactId: input.contactId,
      text: input.text,
      assistantClientId: input.assistantClientId,
      retryCount: input.retryCount,
      companionMode: input.companionMode,
      signal: abortController.signal,
      systemPrompt: input.systemPrompt,
      userClientId: input.userClientId,
      isStopRequested: () => state.stopRequested,
      onConversationReady: (nextConversationId) => {
        state.conversationId = nextConversationId;
        state.storageConversationId = fallbackConversationScope(input.contactId);
        emit(state);
      },
      onUpdateMessage: (clientId, updater) => {
        void updateChatMessage(input.contactId, clientId, updater, input.conversationDateKey);
      },
      autoClozeAfterGeneration: input.autoClozeAfterGeneration,
    });

    if (result.status === "success" && result.assistantMessageId && result.autoClozeState && result.autoClozeBaseVersion !== undefined) {
      try {
        const saved = await updateMessageClozeState({
          messageId: result.assistantMessageId,
          baseVersion: result.autoClozeBaseVersion,
          clozeState: result.autoClozeState,
        });
        await updateChatMessage(
          input.contactId,
          input.assistantClientId,
          (row) => ({ ...row, clozeState: saved.clozeState ?? null, clozeVersion: saved.clozeVersion }),
          input.conversationDateKey,
        );
      } catch {
        // 自动挖空失败不阻断回复展示；下一次云端同步会以服务端状态为准。
      }
    }

    if (result.status === "success" && input.autoCopyAfterGeneration && input.autoCopyMode !== "none" && result.assistantText) {
      await input.onSuccessText?.(result.assistantText, input.autoCopyMode);
    }
    if (result.status === "success") {
      input.onStreamDone?.();
    }
    if (result.status === "failed") {
      input.onFailure?.({
        code: result.errorCode,
        message: result.errorMessage,
        stage: result.errorStage,
      });
    }

    if (state.activeRunId !== runId) return;
    state.isSending = false;
    state.activeAbortController = null;
    state.activeAssistantClientId = null;
    state.stopRequested = false;
    if (activeContactId === input.contactId) activeContactId = null;
    emit(state);
    emitActivity();
  })();
}

function getSnapshot(state: ChatSessionState, changedDateKey: string | null = null): ChatSessionSnapshot {
  return {
    isSending: state.isSending,
    isAnySessionSending: activeContactId !== null,
    activeContactId,
    conversationId: state.conversationId,
    activeAssistantClientId: state.activeAssistantClientId,
    changedDateKey,
  };
}

function emit(state: ChatSessionState, changedDateKey: string | null = null): void {
  const snapshot = getSnapshot(state, changedDateKey);
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
