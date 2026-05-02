/** MessageRepository：定义消息数据读写接口（写入、分页查询、按天查询等）。 */

export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "success" | "failed";

export interface MessageEntity {
  id: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  status: MessageStatus;
  content: string;
  inputChars: number;
  outputChars: number;
  sourceMessageId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMessageInput {
  conversationId: string;
  userId: string;
  role: MessageRole;
  status?: MessageStatus;
  content: string;
  inputChars?: number;
  outputChars?: number;
  sourceMessageId?: string | null;
}

export interface ListByConversationRangeInput {
  conversationId: string;
  from: Date;
  to: Date;
  limit?: number;
}

export interface UpdateMessageStatusInput {
  messageId: string;
  status: MessageStatus;
  outputChars?: number;
}

export interface MessageRepository {
  create(input: CreateMessageInput): Promise<MessageEntity>;
  updateStatus(input: UpdateMessageStatusInput): Promise<MessageEntity>;
  findAssistantBySourceMessageId(sourceMessageId: string): Promise<MessageEntity | null>;
  listByConversation(conversationId: string, limit: number): Promise<MessageEntity[]>;
  listByUserAndDay(userId: string, dayStart: Date, dayEnd: Date): Promise<MessageEntity[]>;
  listByConversationRange(input: ListByConversationRangeInput): Promise<MessageEntity[]>;
}
