import type {
  AIProvider,
  AIProviderConfig,
  RewriteTextInput,
  RewriteTextStreamEvent,
} from "@lf/core/ports/ai/AIProvider.js";

import {
  DEFAULT_REWRITE_SYSTEM_PROMPT,
  buildRewriteUserPrompt,
} from "@lf/core/prompts/rewritePrompt.js";

/** DeepSeekAIProvider：调用 DeepSeek 流式接口实现改写能力。 */
export class DeepSeekAIProvider implements AIProvider {
  readonly providerName = "deepseek";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS ?? "20000");

    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is required");
    }
  }

  get modelName(): string {
    return this.model;
  }

  async rewriteTextStream(
    input: RewriteTextInput,
    onEvent: (event: RewriteTextStreamEvent) => Promise<void> | void
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    const systemPrompt = input.systemPrompt?.trim() || DEFAULT_REWRITE_SYSTEM_PROMPT;
    try {
      if (input.signal?.aborted) {
        controller.abort();
      } else {
        input.signal?.addEventListener("abort", abortFromCaller, { once: true });
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          stream: true,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: buildRewriteUserPrompt(input.text),
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(`DeepSeek stream request failed: ${response.status} ${text}`);
      }

      await onEvent({ type: "start" });

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 事件以空行分隔
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part
            .split("\n")
            .find((item) => item.startsWith("data:"));

          if (!line) continue;

          const raw = line.slice(5).trim();
          if (!raw) continue;
          if (raw === "[DONE]") {
            await onEvent({ type: "done" });
            return;
          }

          const json = JSON.parse(raw) as {
            choices?: Array<{
              delta?: {
                content?: string;
              };
            }>;
          };

          const deltaText = json.choices?.[0]?.delta?.content ?? "";
          if (deltaText) {
            await onEvent({ type: "delta", text: deltaText });
          }
        }
      }

      await onEvent({ type: "done" });
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
      clearTimeout(timer);
    }
  }
}

