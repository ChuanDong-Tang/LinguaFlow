type AbortSignalLike = {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
};

// 前端统一接收的事件类型
export type RewriteStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string; code?: string };

//发起流式改写时需要的参数。
export interface StartRewriteStreamInput {
  userId: string;
  text: string;
  systemPrompt?: string;
  conversationId: string;
  userMessageId: string;
  signal?: AbortSignalLike;
}

// 页面只依赖这个接口
export interface StreamClient {
  startRewriteStream(
    input: StartRewriteStreamInput,
    onEvent: (event: RewriteStreamEvent) => void
  ): Promise<void>;
}
