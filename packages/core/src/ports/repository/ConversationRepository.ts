/** ConversationRepository：定义会话数据读写接口（创建、查询、归档等）。 */

export interface ConversationEntity {
  id: string;
  userId: string;
  contactId: string;
  dateKey: string;
  title: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationInput {
  userId: string;
  contactId: string;
  dateKey: string;
  title?: string | null;
}

export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<ConversationEntity>;
  findById(conversationId: string): Promise<ConversationEntity | null>;
  listByUser(userId: string, limit: number): Promise<ConversationEntity[]>;
  touch(conversationId: string): Promise<void>;
  findByUserContactDate(
    userId: string,
    contactId: string,
    dateKey: string
  ): Promise<ConversationEntity | null>;
}
