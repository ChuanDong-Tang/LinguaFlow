/** 流式改写请求 */
export interface RewriteStreamRequestBody {
  text: string;
  userId: string; // 当前先用 mock userId
  systemPrompt?: string;
  conversationId: string;
  userMessageId: string;
}


/** 服务端推送的流式事件 */
export type RewriteStreamEvent =
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
