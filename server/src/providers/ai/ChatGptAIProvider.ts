import type {
  AIProvider,
  AIProviderConfig,
  ChatTextGenerationInput,
  ChatTextGenerationStreamEvent,
} from "@lf/core/ports/ai/AIProvider.js";

import {
  DEFAULT_REWRITE_SYSTEM_PROMPT,
  ENGLISH_FRIEND_SYSTEM_PROMPT,
  buildEnglishFriendUserPrompt,
  buildRewriteUserPrompt,
} from "@lf/core/Prompts/rewriteAssistantPrompt.js";

export class ChatGPTAIProvider implements AIProvider {
  readonly providerName = "openai";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly allowClientModel: boolean;
  private readonly allowedModels: Set<string>;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.allowClientModel = config.allowClientModel ?? false;
    this.allowedModels = new Set(config.allowedModels ?? []);

  }

  get modelName(): string {
    return this.model;
  }

  resolveProviderName(_requestedProvider?: string): string {
    return this.providerName;
  }

  resolveModelName(input?: string | { model?: string }): string {
    const requestedModel = typeof input === "string" ? input : input?.model;
    const model = requestedModel?.trim();
    if (!model) return this.model;
    if (!this.allowClientModel) return this.model;
    if (this.allowedModels.size > 0 && !this.allowedModels.has(model)) {
      const err = new Error("AI_MODEL_NOT_ALLOWED");
      (err as Error & { code?: string }).code = "AI_MODEL_NOT_ALLOWED";
      throw err;
    }
    return model;
  }

  async generateChatTextStream(
    input: ChatTextGenerationInput,
    onEvent: (event: ChatTextGenerationStreamEvent) => Promise<void> | void
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    const isEnglishFriend = input.contactId === "english_friend";
    const systemPrompt = input.systemPrompt?.trim() || (isEnglishFriend ? ENGLISH_FRIEND_SYSTEM_PROMPT : DEFAULT_REWRITE_SYSTEM_PROMPT);
    const userPrompt = isEnglishFriend ? buildEnglishFriendUserPrompt(input.text) : buildRewriteUserPrompt(input.text);
    const model = this.resolveModelName(input);
    try {
      if (!this.apiKey) {
        throw new Error("OPENAI_API_KEY is required");
      }

      if (input.signal?.aborted) {
        controller.abort();
      } else {
        input.signal?.addEventListener("abort", abortFromCaller, { once: true });
      }

      const response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          instructions: systemPrompt,
          stream: true,
          input: userPrompt,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const upstreamText = await response.text();
        const err = new Error("UPSTREAM_AI_ERROR");
        (err as Error & { code?: string; status?: number; upstreamText?: string }).code = "UPSTREAM_AI_ERROR";
        (err as Error & { code?: string; status?: number; upstreamText?: string }).status = response.status;
        (err as Error & { code?: string; status?: number; upstreamText?: string }).upstreamText = upstreamText;
        throw err;
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
          const dataLines = part
            .split("\n")
            .filter((item) => item.startsWith("data:"));

          if (dataLines.length === 0) continue;

          const raw = dataLines.map((line) => line.slice(5).trim()).join("\n");
          if (!raw) continue;
          if (raw === "[DONE]") {
            await onEvent({ type: "done" });
            return;
          }

          const json = JSON.parse(raw) as {
            type?: string;
            delta?: string;
            error?: {
              code?: string;
              message?: string;
            };
          };

          if (json.type === "response.output_text.delta" && json.delta) {
            await onEvent({ type: "delta", text: json.delta });
            continue;
          }

          if (json.type === "response.completed") {
            await onEvent({ type: "done" });
            return;
          }

          if (json.type === "response.failed" || json.type === "error") {
            const err = new Error(json.error?.message ?? "UPSTREAM_AI_ERROR");
            (err as Error & { code?: string; upstreamCode?: string }).code = "UPSTREAM_AI_ERROR";
            (err as Error & { code?: string; upstreamCode?: string }).upstreamCode = json.error?.code;
            throw err;
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

