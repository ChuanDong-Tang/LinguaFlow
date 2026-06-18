import type {
  AIProvider,
  ChatTextGenerationInput,
  ChatTextGenerationStreamEvent,
} from "@lf/core/ports/ai/AIProvider.js";
import type { AiProviderName } from "../../config/runtimeConfig.js";

export class SelectableAIProvider implements AIProvider {
  constructor(
    private readonly defaultProviderName: AiProviderName,
    private readonly providers: Record<AiProviderName, AIProvider>,
    private readonly allowClientProvider: boolean
  ) {}

  get providerName(): string {
    return this.defaultProviderName;
  }

  get modelName(): string {
    return this.providers[this.defaultProviderName].modelName;
  }

  resolveProviderName(requestedProvider?: string): string {
    const provider = requestedProvider?.trim().toLowerCase();
    if (!provider) return this.defaultProviderName;
    if (!this.allowClientProvider) return this.defaultProviderName;
    if (provider === "chatgpt") return "openai";
    if (provider === "openai" || provider === "deepseek" || provider === "grok") return provider;

    const err = new Error("AI_PROVIDER_NOT_ALLOWED");
    (err as Error & { code?: string }).code = "AI_PROVIDER_NOT_ALLOWED";
    throw err;
  }

  resolveModelName(input?: string | { provider?: string; model?: string }): string {
    const providerName = this.resolveProviderName(typeof input === "string" ? undefined : input?.provider);
    const model = typeof input === "string" ? input : input?.model;
    return this.providers[providerName as AiProviderName].resolveModelName?.(model) ??
      this.providers[providerName as AiProviderName].modelName;
  }

  async generateChatTextStream(
    input: ChatTextGenerationInput,
    onEvent: (event: ChatTextGenerationStreamEvent) => Promise<void> | void
  ): Promise<void> {
    const providerName = this.resolveProviderName(input.provider);
    return this.providers[providerName as AiProviderName].generateChatTextStream(input, onEvent);
  }
}
