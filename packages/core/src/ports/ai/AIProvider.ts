export interface AbortSignalLike {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: "abort", listener: () => void): void;
}

export interface ChatTextGenerationInput{
    userId: string;
    text: string;
    contactId?: string;
    languageCode?: string;
    provider?: string;
    model?: string;
    systemPrompt?: string;
    signal?: AbortSignalLike;
}

export interface ChatTextGenerationOutput{
    text: string;
}

export type ChatTextGenerationStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "done" };

export interface AIProviderConfig{
    apiKey: string;
    baseUrl: string;
    model: string;
    timeoutMs?: number;
    allowClientModel?: boolean;
    allowedModels?: string[];
}

export interface AIProvider{
    readonly providerName: string;
    readonly modelName: string;
    resolveProviderName?(requestedProvider?: string): string;
    resolveModelName?(input?: string | { provider?: string; model?: string }): string;

    generateChatTextStream(
        input: ChatTextGenerationInput,
        onEvent: (event: ChatTextGenerationStreamEvent) => Promise<void> | void
    ): Promise<void>;
}
