import type {
  ChatGenerationStreamEvent,
  StartChatGenerationStreamInput,
  StreamClient,
} from "./streamClient";
import { getAuthHeaders } from "../auth/authHeaders";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const DEFAULT_STREAM_TIMEOUT_MS = 45_000;

function getStreamTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.EXPO_PUBLIC_CHAT_GENERATION_STREAM_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STREAM_TIMEOUT_MS;
}

export class XhrStreamClient implements StreamClient {
  startChatGenerationStream(
    input: StartChatGenerationStreamInput,
    onEvent: (event: ChatGenerationStreamEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let consumedLength = 0;
      let buffer = "";
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        xhr.abort();
      }, getStreamTimeoutMs());

      xhr.open("POST", `${BASE_URL}/chat/generation/stream`);
      xhr.setRequestHeader("Content-Type", "application/json");

      const abortRequest = () => xhr.abort();
      if (input.signal?.aborted) {
        clearTimeout(timeoutId);
        abortRequest();
        return;
      }
      input.signal?.addEventListener("abort", abortRequest, { once: true });

      xhr.onprogress = () => {
        const fullText = xhr.responseText ?? "";
        const newChunk = fullText.slice(consumedLength);
        consumedLength = fullText.length;

        if (!newChunk) return;

        buffer += newChunk;

        // SSE 事件以空行分隔
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((line) => line.startsWith("data:"));

          if (!dataLine) continue;

          const raw = dataLine.slice(5).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as ChatGenerationStreamEvent;
            onEvent(event);
          } catch {
            // 忽略单条解析失败，继续处理后续流片段
          }
        }
      };

      xhr.onload = () => {
        input.signal?.removeEventListener("abort", abortRequest);
        clearTimeout(timeoutId);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`stream failed: ${xhr.status} ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => {
        input.signal?.removeEventListener("abort", abortRequest);
        clearTimeout(timeoutId);
        reject(new Error("network error"));
      };

      xhr.onabort = () => {
        input.signal?.removeEventListener("abort", abortRequest);
        clearTimeout(timeoutId);
        reject(new Error(timedOut ? "request timeout" : "request aborted"));
      };

      void getAuthHeaders()
        .then((headers) => {
          if (input.signal?.aborted) {
            clearTimeout(timeoutId);
            abortRequest();
            return;
          }

          for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
          }

          xhr.send(
            JSON.stringify({
              userId: input.userId,
              text: input.text,
              contactId: input.contactId,
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
              ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
              systemPrompt: input.systemPrompt,
            })
          );
        })
        .catch(reject);
    });
  }
}
