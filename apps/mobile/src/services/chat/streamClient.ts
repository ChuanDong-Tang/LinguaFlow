type AbortSignalLike = {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
};

// 前端统一接收的事件类型
export type ChatGenerationStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | {
      type: "done";
      assistantMessage?: {
        id: string;
        role: "user" | "assistant";
        status: "pending" | "success" | "failed";
        content: string;
        createdAt: string;
        conversationDateKey?: string | null;
        languageCode?: string | null;
        clozeState: {
          groups: Array<{
            tokenIndexes: number[];
            blankTokenIndexes: number[];
          }>;
          correctTokenIndexes: number[];
        } | null;
        clozeVersion: number;
      };
    }
  | { type: "error"; message: string; code?: string };

// 发起流式 AI 回复时需要的参数。
export interface StartChatGenerationStreamInput {
  text: string;
  contactId?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  conversationId?: string;
  userMessageId?: string;
  signal?: AbortSignalLike;
}

// 页面只依赖这个接口
export interface StreamClient {
  startChatGenerationStream(
    input: StartChatGenerationStreamInput,
    onEvent: (event: ChatGenerationStreamEvent) => void
  ): Promise<void>;
}
