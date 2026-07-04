import EventSource from "react-native-sse";
import type {
  ChatGenerationStreamEvent,
  StartChatGenerationStreamInput,
  StreamClient,
} from "./streamClient";
import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const DEFAULT_STREAM_TIMEOUT_MS = 45_000;

function getStreamTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.EXPO_PUBLIC_CHAT_GENERATION_STREAM_TIMEOUT_MS ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_STREAM_TIMEOUT_MS;
}

export class ReactNativeSseStreamClient implements StreamClient {
  startChatGenerationStream(
    input: StartChatGenerationStreamInput,
    onEvent: (event: ChatGenerationStreamEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let eventSource: any = null;

      const timeoutId = setTimeout(() => {
        settle(() => reject(new Error("request timeout")));
      }, getStreamTimeoutMs());

      const cleanup = () => {
        clearTimeout(timeoutId);
        input.signal?.removeEventListener("abort", abortRequest);
        eventSource?.removeAllEventListeners?.();
        eventSource?.close?.();
        eventSource = null;
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const abortRequest = () => {
        settle(() => reject(new Error("request aborted")));
      };

      if (input.signal?.aborted) {
        abortRequest();
        return;
      }

      input.signal?.addEventListener("abort", abortRequest, { once: true });

      void getAuthHeaders()
        .then((headers) => {
          if (input.signal?.aborted) {
            abortRequest();
            return;
          }

          eventSource = new EventSource(`${BASE_URL}/chat/generation/stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              text: input.text,
              contactId: input.contactId,
              provider: input.provider,
              model: input.model,
              companionMode: input.companionMode,
              ...(input.conversationId
                ? { conversationId: input.conversationId }
                : {}),
              ...(input.userMessageId
                ? { userMessageId: input.userMessageId }
                : {}),
              systemPrompt: input.systemPrompt,
            }),
          });

          eventSource.addEventListener("message", (event: any) => {
            const raw = event.data;
            if (!raw) return;

            try {
              const parsed = JSON.parse(raw) as ChatGenerationStreamEvent;
              onEvent(parsed);

              if (parsed.type === "done" || parsed.type === "error") {
                settle(() => resolve());
              }
            } catch (error) {
              console.warn("[stream:sse] parse failed", raw, error);
            }
          });

          eventSource.addEventListener("error", (event: any) => {
            console.warn("[stream:sse] error", event);
            settle(() => reject(new Error("stream error")));
          });
        })
        .catch((error) => {
          settle(() =>
            reject(error instanceof Error ? error : new Error("auth headers failed"))
          );
        });
    });
  }
}
