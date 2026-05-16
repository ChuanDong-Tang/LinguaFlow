/** MessageRepository：定义消息数据读写接口（写入、分页查询、按天查询等）。 */

export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "success" | "failed";

export interface ClozeState {
  groups: Array<{
    tokenIndexes: number[];
    blankTokenIndexes: number[];
  }>;
  correctTokenIndexes: number[];
}

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
  clozeState?: ClozeState | null;
  clozeVersion: number;
  clozePracticeDiscardedAt?: Date | null;
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

export interface ListByConversationDayPageInput {
  conversationId: string;
  from: Date;
  to: Date;
  limit: number;
  beforeCreatedAt?: Date;
  beforeId?: string;
}

export interface UpdateMessageStatusInput {
  messageId: string;
  status: MessageStatus;
  outputChars?: number;
}

export interface UpdateMessageClozeInput {
  messageId: string;
  baseVersion: number;
  clozeState: ClozeState | null;
}

export interface UpdateMessageClozeResult {
  ok: boolean;
  message: MessageEntity;
}

export interface MessageRepository {
  create(input: CreateMessageInput): Promise<MessageEntity>;
  updateStatus(input: UpdateMessageStatusInput): Promise<MessageEntity>;
  updateClozeState(input: UpdateMessageClozeInput): Promise<UpdateMessageClozeResult>;
  discardClozePractice(messageId: string): Promise<MessageEntity>;
  findAssistantBySourceMessageId(sourceMessageId: string): Promise<MessageEntity | null>;
  listByConversation(conversationId: string, limit: number): Promise<MessageEntity[]>;
  listByUserAndDay(userId: string, dayStart: Date, dayEnd: Date): Promise<MessageEntity[]>;
  listByConversationRange(input: ListByConversationRangeInput): Promise<MessageEntity[]>;
  listByConversationDayPage(input: ListByConversationDayPageInput): Promise<MessageEntity[]>;
  findById(messageId: string): Promise<MessageEntity | null>;
}
