import type {
  AIProvider,
  AIProviderConfig,
  ChatTextGenerationInput,
  ChatTextGenerationStreamEvent,
} from "@lf/core/ports/ai/AIProvider.js";

import {
  getPromptProfile,
} from "@lf/core/Prompts/rewriteAssistantPrompt.js";

export class GrokAIProvider implements AIProvider {
  readonly providerName = "grok";
  readonly supportsImageInput = true;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly allowClientModel: boolean;
  private readonly allowedModels: Set<string>;

  constructor(config: AIProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
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
    if (!this.apiKey) {
      throw new Error("GROK_API_KEY or OPENAI_API_KEY is required");
    }
    const controller = new AbortController();
    let timedOut = false;
    let callbackError: unknown;
    const emit = async (event: ChatTextGenerationStreamEvent): Promise<void> => {
      try {
        await onEvent(event);
      } catch (error) {
        callbackError = error;
        throw error;
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    const promptProfile = getPromptProfile({
      contactCode: input.contactId,
      language: input.languageCode,
      appLocale: input.appLocale,
      difficulty: input.promptDifficulty,
      companionMode: input.companionMode,
      systemPromptOverride: input.systemPrompt,
    });
    const systemPrompt = promptProfile.systemPrompt;
    const userPrompt = input.rawUserPrompt ? input.text : promptProfile.buildUserPrompt(input.text);
    const model = this.resolveModelName(input);

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
          model,
          ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
          temperature: input.temperature ?? 1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: input.imageUrls?.length ? [
                { type: "text", text: userPrompt },
                ...input.imageUrls.flatMap((url, index) => [
                  { type: "text" as const, text: `<image_index>${index}</image_index>` },
                  { type: "image_url" as const, image_url: { url } },
                ]),
              ] : userPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const upstreamText = await response.text();
        throw upstreamAIError({
          status: response.ok ? undefined : response.status,
          upstreamCode: extractUpstreamCode(upstreamText),
          upstreamText,
          failureKind: response.ok ? "stream" : "http",
        });
      }

      await emit({ type: "start" });

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const dataLines = part
            .split("\n")
            .filter((item) => item.startsWith("data:"));

          for (const line of dataLines) {
            const raw = line.slice(5).trim();
            if (!raw) continue;
            if (raw === "[DONE]") {
              await emit({ type: "done" });
              return;
            }

            const json = JSON.parse(raw) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                };
                finish_reason?: string | null;
              }>;
              error?: {
                code?: string;
                message?: string;
              };
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };

            if (json.error) {
              throw upstreamAIError({
                upstreamCode: json.error.code,
                failureKind: "stream",
              });
            }

            if (json.usage) {
              const inputTokens = json.usage.prompt_tokens ?? 0;
              const outputTokens = json.usage.completion_tokens ?? 0;
              await emit({ type: "done", usage: { inputTokens, outputTokens, totalTokens: json.usage.total_tokens ?? inputTokens + outputTokens, source: "provider" } });
              return;
            }

            const deltaText = json.choices?.[0]?.delta?.content ?? "";
            if (deltaText) {
              await emit({ type: "delta", text: deltaText });
            }
          }
        }
      }

      await emit({ type: "done" });
    } catch (error) {
      if (error === callbackError) throw error;
      if (isUpstreamAIError(error)) throw error;
      if (input.signal?.aborted && !timedOut) {
        const aborted = new Error("AI_REQUEST_ABORTED") as Error & { code?: string; failureKind?: string };
        aborted.code = "AI_REQUEST_ABORTED";
        aborted.failureKind = "caller_abort";
        throw aborted;
      }
      throw upstreamAIError({
        upstreamCode: timedOut ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_NETWORK_ERROR",
        failureKind: timedOut ? "timeout" : "network",
      });
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
      clearTimeout(timer);
    }
  }
}

type UpstreamAIError = Error & {
  code: "UPSTREAM_AI_ERROR";
  status?: number;
  upstreamCode?: string;
  upstreamText?: string;
  failureKind: "http" | "stream" | "timeout" | "network";
};

function upstreamAIError(input: {
  status?: number;
  upstreamCode?: string;
  upstreamText?: string;
  failureKind: UpstreamAIError["failureKind"];
}): UpstreamAIError {
  const error = new Error("UPSTREAM_AI_ERROR") as UpstreamAIError;
  error.code = "UPSTREAM_AI_ERROR";
  error.failureKind = input.failureKind;
  if (Number.isInteger(input.status)) error.status = input.status;
  const upstreamCode = safeUpstreamCode(input.upstreamCode);
  if (upstreamCode) error.upstreamCode = upstreamCode;
  if (input.upstreamText) error.upstreamText = input.upstreamText;
  return error;
}

function isUpstreamAIError(error: unknown): error is UpstreamAIError {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "UPSTREAM_AI_ERROR");
}

function extractUpstreamCode(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as { error?: { code?: unknown }; code?: unknown };
    return safeUpstreamCode(parsed.error?.code ?? parsed.code) ?? undefined;
  } catch {
    return undefined;
  }
}

function safeUpstreamCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 100 && /^[A-Za-z0-9_.:-]+$/u.test(normalized) ? normalized : null;
}
