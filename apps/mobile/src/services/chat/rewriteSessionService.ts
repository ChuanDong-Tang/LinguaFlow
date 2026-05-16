import type { ChatMessage } from "../../domain/chat/types";
import { clampMessages, updateMessageByLocalId } from "../../domain/chat/messageState";
import { loadLocalMessagesScoped, saveLocalMessagesScoped } from "./chatLocalStorage";
import { runRewriteSync } from "./chatSyncService";
import { getSession } from "../auth/authStorage";
import type { AutoCopyMode } from "../preferences/assistantPreferences";

type RewriteSnapshot = {
  isSending: boolean;
  conversationId: string | null;
  activeAssistantLocalId: string | null;
  messages: ChatMessage[];
};

type RewriteSubscriber = (snapshot: RewriteSnapshot) => void;

type StartRewriteInput = {
  text: string;
  assistantLocalId: string;
  retryCount: number;
  systemPrompt?: string;
  userLocalId?: string;
  conversationId?: string | null;
  autoCopyAfterRewrite: boolean;
  autoCopyMode: AutoCopyMode;
  onSuccessText?: (text: string, mode: AutoCopyMode) => Promise<void>;
};

let messagesCache: ChatMessage[] | null = null;
let isSending = false;
let conversationId: string | null = null;
let activeAssistantLocalId: string | null = null;
let activeAbortController: AbortController | null = null;
let stopRequested = false;
let activeRunId = 0;
let storageUserId: string | null = null;
let storageConversationId: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const subscribers = new Set<RewriteSubscriber>();

export function subscribeRewriteSession(subscriber: RewriteSubscriber): () => void {
  subscribers.add(subscriber);
  subscriber(getSnapshot());
  return () => {
    subscribers.delete(subscriber);
  };
}

export async function ensureRewriteMessagesLoaded(): Promise<ChatMessage[]> {
  const session = await getSession();
  const uid = session?.user?.id ?? "mock_user_001";
  const cid = conversationId ?? "default";
  storageUserId = uid;
  storageConversationId = cid;
  if (messagesCache) return messagesCache;
  messagesCache = await loadLocalMessagesScoped(uid, cid);
  emit();
  return messagesCache;
}

export async function replaceRewriteMessages(rows: ChatMessage[]): Promise<void> {
  messagesCache = rows;
  const session = await getSession();
  const uid = storageUserId ?? session?.user?.id ?? "mock_user_001";
  const cid = storageConversationId ?? conversationId ?? "default";
  storageUserId = uid;
  storageConversationId = cid;
  await saveLocalMessagesScoped(uid, cid, rows);
  emit();
}

export async function appendRewriteMessages(rows: ChatMessage[]): Promise<ChatMessage[]> {
  const prev = await ensureRewriteMessagesLoaded();
  const next = clampMessages([...prev, ...rows], 10000);
  messagesCache = next;
  const session = await getSession();
  const uid = storageUserId ?? session?.user?.id ?? "mock_user_001";
  const cid = storageConversationId ?? conversationId ?? "default";
  storageUserId = uid;
  storageConversationId = cid;
  await saveLocalMessagesScoped(uid, cid, next);
  emit();
  return next;
}

export function updateRewriteMessage(
  localId: string,
  updater: (message: ChatMessage) => ChatMessage
): void {
  if (!messagesCache) {
    void ensureRewriteMessagesLoaded().then(() => updateRewriteMessage(localId, updater));
    return;
  }

  const next = updateMessageByLocalId(messagesCache, localId, updater);
  messagesCache = next;
  schedulePersist();
  emit();
}

function schedulePersist(delayMs = 180): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, delayMs);
}

async function flushPersist(): Promise<void> {
  if (!messagesCache) return;
  const snapshot = messagesCache;
  const session = await getSession();
  const uid = storageUserId ?? session?.user?.id ?? "mock_user_001";
  const cid = storageConversationId ?? conversationId ?? "default";
  await saveLocalMessagesScoped(uid, cid, snapshot);
}

export function stopRewriteSession(): void {
  if (!activeAbortController || !activeAssistantLocalId) return;
  stopRequested = true;
  activeAbortController.abort();
  void flushPersist();
  emit();
}

export function startRewriteSession(input: StartRewriteInput): void {
  if (isSending) return;

  const abortController = new AbortController();
  const runId = activeRunId + 1;
  activeRunId = runId;
  isSending = true;
  activeAbortController = abortController;
  activeAssistantLocalId = input.assistantLocalId;
  stopRequested = false;
  if (input.conversationId) conversationId = input.conversationId;
  if (conversationId) {
    void (async () => {
      const session = await getSession();
      storageUserId = session?.user?.id ?? "mock_user_001";
      storageConversationId = conversationId;
      if (!messagesCache || messagesCache.length === 0) {
        messagesCache = await loadLocalMessagesScoped(storageUserId, storageConversationId);
      }
      emit();
    })();
  }
  emit();

  void (async () => {
    const result = await runRewriteSync({
      text: input.text,
      assistantLocalId: input.assistantLocalId,
      retryCount: input.retryCount,
      signal: abortController.signal,
      systemPrompt: input.systemPrompt,
      userLocalId: input.userLocalId,
      isStopRequested: () => stopRequested,
      onConversationReady: (nextConversationId) => {
        conversationId = nextConversationId;
        storageConversationId = nextConversationId;
        emit();
      },
      onUpdateMessage: (localId, updater) => {
        updateRewriteMessage(localId, updater);
      },
    });

    if (result.status === "success" && input.autoCopyAfterRewrite && result.assistantText) {
      await input.onSuccessText?.(result.assistantText, input.autoCopyMode);
    }

    if (activeRunId !== runId) return;
    await flushPersist();
    isSending = false;
    activeAbortController = null;
    activeAssistantLocalId = null;
    stopRequested = false;
    emit();
  })();
}

function getSnapshot(): RewriteSnapshot {
  return {
    isSending,
    conversationId,
    activeAssistantLocalId,
    messages: messagesCache ?? [],
  };
}

function emit(): void {
  const snapshot = getSnapshot();
  for (const subscriber of subscribers) {
    subscriber(snapshot);
  }
}
