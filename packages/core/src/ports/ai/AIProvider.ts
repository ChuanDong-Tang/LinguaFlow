export interface AbortSignalLike {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: "abort", listener: () => void): void;
}

export interface RewriteTextInput{
    userId: string;
    text: string;
    systemPrompt?: string;
    signal?: AbortSignalLike;
}

export interface RewriteTextOutput{
    rewrittenText: string;
}

export type RewriteTextStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "done" };

export interface AIProviderConfig{
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface AIProvider{
    readonly providerName: string;
    readonly modelName: string;

    rewriteTextStream(
        input: RewriteTextInput,
        onEvent: (event: RewriteTextStreamEvent) => Promise<void> | void
    ): Promise<void>;
}
