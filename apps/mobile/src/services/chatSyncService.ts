import { getSession } from "./authStorage";
import { loadDebugSettings } from "./debugSettingsStorage";
import { sendMessageToCloud } from "./chatHistoryApi";
import { startRewriteStream } from "./chatStream";
import type { ChatMessage } from "../screens/chat/types";
import { nowHHMM } from "../screens/chat/messageState";

const CONTACT_ID = "rewrite_assistant";

export type RewriteStatus = "success" | "failed" | "stopped";

export type LocalRewritePair = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
};

export type RunRewriteInput = {
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

export type RunRewriteResult = {
  status: RewriteStatus;
  assistantText: string;
  errorMessage?: string;
};

export function createLocalRewritePair(text: string, now = new Date()): LocalRewritePair {
  const stamp = now.getTime();
  const time = nowHHMM();
  const createdAt = now.toISOString();

  return {
    userMessage: {
      localId: `local-user-${stamp}`,
      role: "user",
      text,
      time,
      createdAt,
      status: "pending",
    },
    assistantMessage: {
      localId: `local-assistant-${stamp}`,
      role: "assistant",
      text: "",
      time,
      createdAt,
      status: "pending",
      retryText: text,
      retryCount: 0,
    },
  };
}

export async function runRewriteSync(input: RunRewriteInput): Promise<RunRewriteResult> {
  let requestSystemPrompt = input.systemPrompt;
  let assistantText = "";
  let streamErrorMessage: string | null = null;

  try {
    const session = await getSession();
    const userId = session?.user?.id ?? "mock_user_001";
    const debugSettings = await loadDebugSettings();
    requestSystemPrompt = input.systemPrompt ?? debugSettings.systemPrompt.trim();

    const cloud = await sendMessageToCloud({
      text: input.text,
      contactId: CONTACT_ID,
    });
    input.onConversationReady?.(cloud.conversationId);

    await startRewriteStream(
      {
        userId,
        text: input.text,
        conversationId: cloud.conversationId,
        userMessageId: cloud.userMessage.id,
        systemPrompt: requestSystemPrompt || undefined,
        signal: input.signal,
      },
      (event) => {
        if (event.type === "delta") {
          assistantText += event.text;
          input.onUpdateMessage(input.assistantLocalId, (row) => ({
            ...row,
            text: row.text + event.text,
            createdAt: new Date().toISOString(),
          }));
        }

        if (event.type === "error") {
          streamErrorMessage = event.message;
          markFailed(input, `[错误] ${event.message}`, requestSystemPrompt);
        }

        if (event.type === "done") {
          if (input.userLocalId) {
            input.onUpdateMessage(input.userLocalId, (row) => ({ ...row, status: "success" }));
          }
          input.onUpdateMessage(input.assistantLocalId, (row) => ({
            ...row,
            status: "success",
            retryText: input.text,
            retryCount: input.retryCount,
            retrySystemPrompt: requestSystemPrompt,
            createdAt: new Date().toISOString(),
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

function markFailed(input: RunRewriteInput, text: string, systemPrompt?: string): void {
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
