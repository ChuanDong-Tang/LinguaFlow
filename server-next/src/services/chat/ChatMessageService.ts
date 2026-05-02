import type { ConversationRepository } from "@lf/core/ports/repository/ConversationRepository";
import type { MessageRepository } from "@lf/core/ports/repository/MessageRepository";

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
  fromDateKey: string; // YYYY-MM-DD (server timezone)
  toDateKey: string; // YYYY-MM-DD (server timezone)
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

  async listConversationMessages(conversationId: string): Promise<MessageView[]> {
    const rows = await this.messageRepository.listByConversation(conversationId, 200);
    return rows.map((row) => this.toView(row));
  }

  async listConversationMessagesByDateRange(
    input: ListMessagesByDateRangeInput
  ): Promise<MessageView[]> {
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
}
