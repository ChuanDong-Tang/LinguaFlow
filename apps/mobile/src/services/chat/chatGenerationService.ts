import { loadDebugSettings } from "../preferences/debugSettingsStorage";
import { ApiError, sendMessageToCloud } from "../api/chatHistoryApi";
import { getCurrentEntitlement } from "../api/meApi";
import { startChatGenerationStream } from "./chatGenerationStream";
import type { ChatGenerationStreamEvent } from "./streamClient";
import { hasLocalProAccess } from "../entitlement/proAccess";
import type { ChatMessage } from "../../domain/chat/types";
import { toDateKey } from "../../domain/chat/messageState";
import { t, tf } from "../../i18n";

const ENABLE_DEBUG_PROMPT_PANEL = process.env.EXPO_PUBLIC_SHOW_DEBUG_PROMPT_PANEL === "true";

export type ChatGenerationStatus = "success" | "failed" | "stopped";

export type LocalChatPair = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

export type RunChatGenerationInput = {
  contactId: string;
  text: string;
  assistantClientId: string;
  retryCount: number;
  companionMode?: "rewrite_only" | "native_note" | "simple_reply";
  signal: AbortSignal;
  systemPrompt?: string;
  userClientId?: string;
  isStopRequested?: () => boolean;
  onConversationReady?: (conversationId: string) => void;
  onUpdateMessage: (clientId: string, updater: (message: ChatMessage) => ChatMessage) => void;
};

export type RunChatGenerationResult = {
  status: ChatGenerationStatus;
  assistantText: string;
  assistantMessageId?: string;
  errorMessage?: string;
  errorCode?: string;
  errorStage?: "input" | "output";
};

export function createLocalChatPair(
  text: string,
  now = new Date(),
  conversationDateKey = toDateKey(now)
): LocalChatPair {
  const stamp = now.getTime();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const createdAt = now.toISOString();
  const assistantCreatedAt = new Date(stamp + 1).toISOString();

  return {
    userMessage: {
      localId: `local-user-${stamp}`,
      clientId:`local-user-${stamp}`,
      serverId: null,
      role: "user",
      text,
      time,
      createdAt,
      conversationDateKey,
      status: "pending",
      contactId: null,
    },
    assistantMessage: {
      localId: `local-assistant-${stamp}`,
      clientId:`local-assistant-${stamp}`,
      serverId: null,
      role: "assistant",
      text: "",
      time,
      createdAt: assistantCreatedAt,
      conversationDateKey,
      status: "pending",
      contactId: null,
      retryText: text,
      retryCount: 0,
    },
  };
}

export async function runChatGeneration(input: RunChatGenerationInput): Promise<RunChatGenerationResult> {
  let requestSystemPrompt = input.systemPrompt?.trim() || undefined;
  let assistantText = "";
  let streamErrorMessage: string | null = null;
  let streamErrorCode: string | undefined;
  let streamErrorStage: "input" | "output" | undefined;
  let userMessageClientId = input.userClientId;
  let pendingDelta = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let streamDoneEvent: Extract<ChatGenerationStreamEvent, { type: "done" }> | null = null;
  let completedAssistantMessageId: string | undefined;
  let resolveTypingDrain: (() => void) | null = null;
  const FLUSH_INTERVAL_MS = 35;
  const MAX_CHARS_PER_FLUSH = 4;

  const markSucceeded = (event: Extract<ChatGenerationStreamEvent, { type: "done" }>) => {
    const finalText = event.assistantMessage?.content || assistantText;
    const baseClozeState = event.assistantMessage?.clozeState ?? null;
    const baseClozeVersion = event.assistantMessage?.clozeVersion ?? 0;
    completedAssistantMessageId = event.assistantMessage?.id;
    if (userMessageClientId) {
      input.onUpdateMessage(userMessageClientId, (row) => ({ ...row, status: "success" }));
    }
    input.onUpdateMessage(input.assistantClientId, (row) => ({
      ...row,
      id: event.assistantMessage?.id ?? row.id,
      serverId: event.assistantMessage?.id ?? row.serverId ?? null,
      status: "success",
      clozeState: baseClozeState ?? row.clozeState ?? null,
      clozeVersion: baseClozeVersion,
      retryText: input.text,
      retryCount: input.retryCount,
      retrySystemPrompt: requestSystemPrompt,
      conversationDateKey: event.assistantMessage?.conversationDateKey ?? row.conversationDateKey,
      languageCode: event.assistantMessage?.languageCode ?? row.languageCode ?? null,
      createdAt: event.assistantMessage?.createdAt ?? row.createdAt,
    }));
  };

  const flushDelta = (options?: { all?: boolean }) => {
    if (!pendingDelta) return;
    const chunk = options?.all
      ? pendingDelta
      : pendingDelta.slice(0, MAX_CHARS_PER_FLUSH);
    pendingDelta = pendingDelta.slice(chunk.length);
    assistantText += chunk;
    input.onUpdateMessage(input.assistantClientId, (row) => ({
      ...row,
      text: row.text + chunk,
    }));
  };
  // 网络层可以很快收到 delta；UI 层固定节奏吐字，避免一大段瞬间刷出来。
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushDelta();
      if (pendingDelta) {
        scheduleFlush();
      } else if (streamDoneEvent && resolveTypingDrain) {
        const done = streamDoneEvent;
        streamDoneEvent = null;
        const resolve = resolveTypingDrain;
        resolveTypingDrain = null;
        markSucceeded(done);
        resolve();
      }
    }, FLUSH_INTERVAL_MS);
  };

  const waitForTypingDrain = (event: Extract<ChatGenerationStreamEvent, { type: "done" }>) => {
    if (!pendingDelta) {
      markSucceeded(event);
      return Promise.resolve();
    }
    streamDoneEvent = event;
    scheduleFlush();
    return new Promise<void>((resolve) => {
      resolveTypingDrain = resolve;
    });
  };

  try {
    const debugSettings = ENABLE_DEBUG_PROMPT_PANEL ? await loadDebugSettings() : null;
    const contactPrompt = debugSettings?.systemPromptsByContactId[input.contactId as keyof typeof debugSettings.systemPromptsByContactId]?.trim() || undefined;
    const requestProvider = debugSettings?.provider.trim() || undefined;
    const requestModel = debugSettings?.model.trim() || undefined;
    const explicitPrompt = input.systemPrompt?.trim() || undefined;
    requestSystemPrompt = explicitPrompt ?? contactPrompt ?? "";

    const localPro = await hasLocalProAccess();
    const entitlement = localPro ? await getCurrentEntitlement().catch(() => null) : null;
    const cloud = (entitlement?.features?.cloudSync ?? entitlement?.isMember ?? entitlement?.isPro) === true
      ? await sendMessageToCloud({
          text: input.text,
          contactId: input.contactId,
        })
      : null;
    if (cloud) input.onConversationReady?.(cloud.conversationId);
    if (cloud?.userMessage?.id && userMessageClientId) {
      input.onUpdateMessage(userMessageClientId, (row) => ({
        ...row,
        id: cloud.userMessage.id,
        serverId: cloud.userMessage.id,
        status: cloud.userMessage.status ?? row.status,
        conversationDateKey: cloud.userMessage.conversationDateKey ?? row.conversationDateKey,
        languageCode: cloud.userMessage.languageCode ?? row.languageCode ?? null,
      }));
    }

    await startChatGenerationStream(
      {
        text: input.text,
        contactId: input.contactId,
        provider: requestProvider,
        model: requestModel,
        companionMode: input.companionMode,
        conversationId: cloud?.conversationId,
        userMessageId: cloud?.userMessage.id,
        systemPrompt: requestSystemPrompt || undefined,
        signal: input.signal,
      },
      (event) => {
        if (event.type === "delta") {
          pendingDelta += event.text;
          scheduleFlush();
        }

        if (event.type === "error") {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushDelta({ all: true });
          streamErrorMessage = event.message;
          streamErrorCode = event.code;
          streamErrorStage = event.stage;
          markFailed(input, tf("chat.error.prefix", { message: event.message }), requestSystemPrompt, userMessageClientId);
        }

        if (event.type === "done") {
          void waitForTypingDrain(event);
        }
      }
    );
    if (streamDoneEvent || pendingDelta) {
      await new Promise<void>((resolve) => {
        if (!streamDoneEvent && !pendingDelta) {
          resolve();
          return;
        }
        const previousResolve = resolveTypingDrain;
        resolveTypingDrain = () => {
          previousResolve?.();
          resolve();
        };
        scheduleFlush();
      });
    }

    if (streamErrorMessage) {
      return {
        status: "failed",
        assistantText,
        errorMessage: streamErrorMessage,
        errorCode: streamErrorCode,
        errorStage: streamErrorStage,
      };
    }

    return {
      status: "success",
      assistantText,
      assistantMessageId: completedAssistantMessageId,
    };
  } catch (error) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushDelta({ all: true });
    const wasStopped = input.isStopRequested?.() === true;
    const message = wasStopped ? t("chat.error.stopped") : error instanceof Error ? error.message : "stream failed";
    const code = error instanceof ApiError ? error.code : undefined;
    const stage = error instanceof ApiError ? error.stage : undefined;
    markFailed(input, tf("chat.error.prefix", { message }), requestSystemPrompt, userMessageClientId);
    return {
      status: wasStopped ? "stopped" : "failed",
      assistantText,
      errorMessage: message,
      errorCode: code,
      errorStage: stage,
    };
  }
}

function markFailed(
  input: RunChatGenerationInput,
  text: string,
  systemPrompt?: string,
  userMessageClientId?: string
): void {
  if (userMessageClientId) {
    input.onUpdateMessage(userMessageClientId, (row) => ({ ...row, status: "failed" }));
  }
  input.onUpdateMessage(input.assistantClientId, (row) => ({
    ...row,
    text,
    status: "failed",
    retryText: input.text,
    retryCount: input.retryCount,
    retrySystemPrompt: systemPrompt,
  }));
}
