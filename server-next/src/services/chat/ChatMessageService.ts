import type { ConversationRepository } from "@lf/core/ports/repository/ConversationRepository.js";
import type { MessageRepository } from "@lf/core/ports/repository/MessageRepository.js";

export interface SendMessageInput {
  userId: string;
  contactId: string;
  text: string;
}

export interface MessageView {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "success" | "failed";
  content: string;
  createdAt: string;
}

export interface SendMessageResult {
  conversationId: string;
  userMessage: MessageView;
}

export interface ListMessagesByDateRangeInput {
  conversationId: string;
  userId: string;
  fromDateKey: string; // YYYY-MM-DD (server timezone)
  toDateKey: string; // YYYY-MM-DD (server timezone)
}

export class ConversationAccessDeniedError extends Error {
  readonly code = "CONVERSATION_NOT_FOUND";

  constructor() {
    super("Conversation not found");
  }
}

export class MessageAccessDeniedError extends Error {
  readonly code = "MESSAGE_NOT_FOUND";

  constructor() {
    super("Message not found");
  }
}

export class ChatMessageService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository
  ) {}

  private toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  async sendUserMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const dateKey = this.toDateKey(new Date());

    let conversation = await this.conversationRepository.findByUserContactDate(
      input.userId,
      input.contactId,
      dateKey,
    );

    if(!conversation) {
      conversation = await this.conversationRepository.create({
        userId: input.userId,
        contactId: input.contactId,
        title: null,
        dateKey,
      });
    }

    const userMessage = await this.messageRepository.create({
      conversationId: conversation.id,
      userId: input.userId,
      role: "user",
      status: "pending",
      content: input.text,
      inputChars: input.text.length,
      outputChars: 0,
    });

    return {
      conversationId: conversation.id,
      userMessage: this.toView(userMessage),
    };
  }

  async markUserMessageSuccess(messageId: string): Promise<MessageView> {
    const updated = await this.messageRepository.updateStatus({
      messageId,
      status: "success",
    });
    return this.toView(updated);
  }

  async markUserMessageFailed(messageId: string): Promise<MessageView> {
    const updated = await this.messageRepository.updateStatus({
      messageId,
      status: "failed",
    });
    return this.toView(updated);
  }

  async createAssistantMessage(
    conversationId: string,
    userId: string,
    content: string,
    sourceMessageId: string
  ): Promise<MessageView> {
    const existing = await this.messageRepository.findAssistantBySourceMessageId(sourceMessageId);
    if (existing) return this.toView(existing);

    const msg = await this.messageRepository.create({
      conversationId,
      userId,
      role: "assistant",
      status: "success",
      content,
      inputChars: 0,
      outputChars: content.length,
      sourceMessageId,
    });

    return this.toView(msg);
  }

  async listConversationMessages(input: {
    conversationId: string;
    userId: string;
  }): Promise<MessageView[]> {
    await this.assertConversationBelongsToUser(input.conversationId, input.userId);

    const rows = await this.messageRepository.listByConversation(input.conversationId, 200);
    return rows.map((row) => this.toView(row));
  }

  async listConversationMessagesByDateRange(
    input: ListMessagesByDateRangeInput
  ): Promise<MessageView[]> {
    await this.assertConversationBelongsToUser(input.conversationId, input.userId);

    const fromStart = new Date(`${input.fromDateKey}T00:00:00+08:00`);
    const toEnd = new Date(`${input.toDateKey}T23:59:59.999+08:00`);

    const rows = await this.messageRepository.listByConversationRange({
      conversationId: input.conversationId,
      from: fromStart,
      to: toEnd,
      limit: 500,
    });

    return rows.map((row) => this.toView(row));
  }

  private async assertConversationBelongsToUser(
    conversationId: string,
    userId: string
  ): Promise<void> {
    const conversation = await this.conversationRepository.findById(conversationId);

    if (!conversation || conversation.userId !== userId) {
      throw new ConversationAccessDeniedError();
    }
  }

  private toView(row: {
    id: string;
    role: "user" | "assistant";
    status: "pending" | "success" | "failed";
    content: string;
    createdAt: Date;
  }): MessageView {
    return {
      id: row.id,
      role: row.role,
      status: row.status,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async assertUserMessageOwnership(input: {
    userId: string;
    conversationId: string;
    userMessageId: string;
  }): Promise<void> {
    await this.assertConversationBelongsToUser(input.conversationId, input.userId);

    const message = await this.messageRepository.findById(input.userMessageId);
    if (!message) {
      throw new MessageAccessDeniedError();
    }

    if (
      message.userId !== input.userId ||
      message.conversationId !== input.conversationId ||
      message.role !== "user"
    ) {
      throw new MessageAccessDeniedError();
    }
  }

}


