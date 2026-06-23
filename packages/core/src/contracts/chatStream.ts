/** 流式改写请求 */
export interface ChatGenerationStreamRequestBody {
  text: string;
  contactId?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  conversationId?: string;
  userMessageId?: string;
}


/** 服务端推送的流式事件 */
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
        conversationDateKey: string | null;
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
