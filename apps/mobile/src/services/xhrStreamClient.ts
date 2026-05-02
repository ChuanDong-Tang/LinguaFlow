import type {
  RewriteStreamEvent,
  StartRewriteStreamInput,
  StreamClient,
} from "./streamClient";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export class XhrStreamClient implements StreamClient {
  startRewriteStream(
    input: StartRewriteStreamInput,
    onEvent: (event: RewriteStreamEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let consumedLength = 0;
      let buffer = "";

      xhr.open("POST", `${BASE_URL}/chat/rewrite/stream`);
      xhr.setRequestHeader("Content-Type", "application/json");

      const abortRequest = () => xhr.abort();
      if (input.signal?.aborted) {
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
            const event = JSON.parse(raw) as RewriteStreamEvent;
            onEvent(event);
          } catch {
            // 忽略单条解析失败，继续处理后续流片段
          }
        }
      };

      xhr.onload = () => {
        input.signal?.removeEventListener("abort", abortRequest);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`stream failed: ${xhr.status} ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => {
        input.signal?.removeEventListener("abort", abortRequest);
        reject(new Error("network error"));
      };

      xhr.onabort = () => {
        input.signal?.removeEventListener("abort", abortRequest);
        reject(new Error("request aborted"));
      };

      xhr.send(
        JSON.stringify({
          userId: input.userId,
          text: input.text,
          conversationId: input.conversationId,
          userMessageId: input.userMessageId,
          systemPrompt: input.systemPrompt,
        })
      );
    });
  }
}
