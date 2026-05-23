import { getSession } from "../auth/authStorage";
import { loadDebugSettings } from "../preferences/debugSettingsStorage";
import { sendMessageToCloud } from "../api/chatHistoryApi";
import { getCurrentEntitlement } from "../api/meApi";
import { startChatGenerationStream } from "./chatGenerationStream";
import { hasLocalProAccess } from "../entitlement/proAccess";
import type { ChatMessage } from "../../domain/chat/types";
import { nowHHMM, toDateKey } from "../../domain/chat/messageState";

export type ChatGenerationStatus = "success" | "failed" | "stopped";

export type LocalChatPair = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

export type RunChatGenerationInput = {
  contactId: string;
  text: string;
  assistantLocalId: string;
  retryCount: number;
  signal: AbortSignal;
  systemPrompt?: string;
  userLocalId?: string;
  isStopRequested?: () => boolean;
  onConversationReady?: (conversationId: string) => void;
  onUpdateMessage: (localId: string, updater: (message: ChatMessage) => ChatMessage) => void;
};

export type RunChatGenerationResult = {
  status: ChatGenerationStatus;
  assistantText: string;
  errorMessage?: string;
};

export function createLocalChatPair(text: string, now = new Date()): LocalChatPair {
  const stamp = now.getTime();
  const time = nowHHMM();
  const createdAt = now.toISOString();
  const conversationDateKey = toDateKey(now);

  return {
    userMessage: {
      localId: `local-user-${stamp}`,
      role: "user",
      text,
      time,
      createdAt,
      conversationDateKey,
      status: "pending",
    },
    assistantMessage: {
      localId: `local-assistant-${stamp}`,
      role: "assistant",
      text: "",
      time,
      createdAt,
      conversationDateKey,
      status: "pending",
      retryText: text,
      retryCount: 0,
    },
  };
}

export async function runChatGeneration(input: RunChatGenerationInput): Promise<RunChatGenerationResult> {
  let requestSystemPrompt = input.systemPrompt;
  let assistantText = "";
  let streamErrorMessage: string | null = null;
  let pendingDelta = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushDelta = () => {
    if (!pendingDelta) return;
    const chunk = pendingDelta;
    pendingDelta = "";
    assistantText += chunk;
    input.onUpdateMessage(input.assistantLocalId, (row) => ({
      ...row,
      text: row.text + chunk,
      createdAt: new Date().toISOString(),
    }));
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushDelta();
    }, 40);
  };

  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "mock_user_001";
    const debugSettings = await loadDebugSettings();
    const contactPrompt = debugSettings.systemPromptsByContactId[input.contactId as keyof typeof debugSettings.systemPromptsByContactId]?.trim();
    requestSystemPrompt = input.systemPrompt ?? contactPrompt ?? "";

    const localPro = await hasLocalProAccess();
    const entitlement = localPro ? await getCurrentEntitlement().catch(() => null) : null;
    const cloud = entitlement?.isPro === true
      ? await sendMessageToCloud({
          text: input.text,
          contactId: input.contactId,
        })
      : null;
    if (cloud) input.onConversationReady?.(cloud.conversationId);

    await startChatGenerationStream(
      {
        userId,
        text: input.text,
        contactId: input.contactId,
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
          flushDelta();
          streamErrorMessage = event.message;
          markFailed(input, `[错误] ${event.message}`, requestSystemPrompt);
        }

        if (event.type === "done") {
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          flushDelta();
          if (input.userLocalId) {
            input.onUpdateMessage(input.userLocalId, (row) => ({ ...row, status: "success" }));
          }
          input.onUpdateMessage(input.assistantLocalId, (row) => ({
            ...row,
            id: event.assistantMessage?.id ?? row.id,
            localId: event.assistantMessage?.id ?? row.localId,
            status: "success",
            clozeState: event.assistantMessage?.clozeState ?? row.clozeState ?? null,
            clozeVersion: event.assistantMessage?.clozeVersion ?? row.clozeVersion ?? 0,
            retryText: input.text,
            retryCount: input.retryCount,
            retrySystemPrompt: requestSystemPrompt,
            conversationDateKey: event.assistantMessage?.conversationDateKey ?? row.conversationDateKey,
            createdAt: event.assistantMessage?.createdAt ?? new Date().toISOString(),
          }));
        }
      }
    );

    if (streamErrorMessage) {
      return {
        status: "failed",
        assistantText,
        errorMessage: streamErrorMessage,
      };
    }

    return { status: "success", assistantText };
  } catch (error) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushDelta();
    const wasStopped = input.isStopRequested?.() === true;
    const message = wasStopped ? "已停止生成" : error instanceof Error ? error.message : "stream failed";
    markFailed(input, `[错误] ${message}`, requestSystemPrompt);
    return {
      status: wasStopped ? "stopped" : "failed",
      assistantText,
      errorMessage: message,
    };
  }
}

function markFailed(input: RunChatGenerationInput, text: string, systemPrompt?: string): void {
  if (input.userLocalId) {
    input.onUpdateMessage(input.userLocalId, (row) => ({ ...row, status: "failed" }));
  }
  input.onUpdateMessage(input.assistantLocalId, (row) => ({
    ...row,
    text,
    status: "failed",
    retryText: input.text,
    retryCount: input.retryCount,
    retrySystemPrompt: systemPrompt,
    createdAt: new Date().toISOString(),
  }));
}
