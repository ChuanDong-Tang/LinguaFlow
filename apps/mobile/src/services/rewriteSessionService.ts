import type { ChatMessage } from "../screens/chat/types";
import { clampMessages, updateMessageByLocalId } from "../screens/chat/messageState";
import { loadLocalMessages, saveLocalMessages } from "./chatLocalStorage";
import { runRewriteSync } from "./chatSyncService";

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
  onSuccessText?: (text: string) => Promise<void>;
};

let messagesCache: ChatMessage[] | null = null;
let isSending = false;
let conversationId: string | null = null;
let activeAssistantLocalId: string | null = null;
let activeAbortController: AbortController | null = null;
let stopRequested = false;
let activeRunId = 0;

const subscribers = new Set<RewriteSubscriber>();

export function subscribeRewriteSession(subscriber: RewriteSubscriber): () => void {
  subscribers.add(subscriber);
  subscriber(getSnapshot());
  return () => {
    subscribers.delete(subscriber);
  };
}

export async function ensureRewriteMessagesLoaded(): Promise<ChatMessage[]> {
  if (messagesCache) return messagesCache;
  messagesCache = await loadLocalMessages();
  emit();
  return messagesCache;
}

export async function replaceRewriteMessages(rows: ChatMessage[]): Promise<void> {
  messagesCache = rows;
  await saveLocalMessages(rows);
  emit();
}

export async function appendRewriteMessages(rows: ChatMessage[]): Promise<ChatMessage[]> {
  const prev = await ensureRewriteMessagesLoaded();
  const next = clampMessages([...prev, ...rows], 10000);
  messagesCache = next;
  await saveLocalMessages(next);
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
  void saveLocalMessages(next);
  emit();
}

export function stopRewriteSession(): void {
  if (!activeAbortController || !activeAssistantLocalId) return;
  stopRequested = true;
  activeAbortController.abort();
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
        emit();
      },
      onUpdateMessage: (localId, updater) => {
        updateRewriteMessage(localId, updater);
      },
    });

    if (result.status === "success" && input.autoCopyAfterRewrite && result.assistantText) {
      await input.onSuccessText?.(result.assistantText);
    }

    if (activeRunId !== runId) return;
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
