export type ConversationRole = "curious_note" | "curious_input";

export type MessageSender = "user" | "assistant" | "system";

export type Conversation = {
  id: string;
  userId: string;
  role: ConversationRole;
  conversationDate: string;//YYYY-MM-DD
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  sender: MessageSender;
  content: string;
  createdAt: string;
};

// 改写请求体
export interface RewriteRequestBody{
  text: string;
  userId: string; // mock userid temp 
}

// 改写响应体
export interface RewriteResponseBody{
  rewrittenText: string;
}