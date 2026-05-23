import type { ConversationRepository } from "@lf/core/ports/repository/ConversationRepository.js";
import type { ClozeState, MessageRepository } from "@lf/core/ports/repository/MessageRepository.js";

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
  conversationDateKey: string | null;
  clozeState: ClozeState | null;
  clozeVersion: number;
  clozePracticeDiscardedAt: string | null;
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

export interface FindConversationByDateInput {
  userId: string;
  contactId: string;
  dateKey: string;
}

export interface ListConversationDateKeysInput {
  userId: string;
  contactId: string;
  fromDateKey: string;
  toDateKey: string;
}

export interface ListPracticeDateKeysInput {
  userId: string;
  contactIds: string[];
  fromDateKey: string;
  toDateKey: string;
}

export interface ListDayMessagesPageInput {
  conversationId: string;
  userId: string;
  dateKey: string;
  limit: number;
  beforeCreatedAt?: string;
  beforeId?: string;
}

export interface ListDayMessagesPageResult {
  items: MessageView[];
  nextCursor: {
    beforeCreatedAt: string;
    beforeId: string;
  } | null;
}

export interface UpdateMessageClozeInput {
  userId: string;
  messageId: string;
  baseVersion: number;
  clozeState: ClozeState | null;
}

export interface UpdateMessageClozeResult {
  clozeState: ClozeState | null;
  clozeVersion: number;
}

export interface DiscardClozePracticeResult {
  messageId: string;
  clozePracticeDiscardedAt: string;
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

export class MessageClozeConflictError extends Error {
  readonly code = "CLOZE_VERSION_CONFLICT";
  readonly latest: UpdateMessageClozeResult;

  constructor(latest: UpdateMessageClozeResult) {
    super("Cloze state has changed");
    this.latest = latest;
  }
}

export class InvalidClozeStateError extends Error {
  readonly code = "INVALID_CLOZE_STATE";

  constructor(message = "Invalid cloze state") {
    super(message);
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
      conversationDateKey: conversation.dateKey,
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
    const conversation = await this.conversationRepository.findById(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new ConversationAccessDeniedError();
    }

    const msg = await this.messageRepository.create({
      conversationId,
      userId,
      role: "assistant",
      status: "success",
      content,
      inputChars: 0,
      outputChars: content.length,
      sourceMessageId,
      conversationDateKey: conversation.dateKey,
    });

    return this.toView(msg);
  }

  async listConversationMessages(input: {
    conversationId: string;
    userId: string;
  }): Promise<MessageView[]> {
    await this.assertConversationBelongsToUser(input.conversationId, input.userId);

    const rows = await this.messageRepository.listByConversation(input.conversationId, 200);
    return rows
      .filter((row) => row.status !== "failed")
      .map((row) => this.toView(row));
  }

  async findConversationIdByUserContactDate(
    input: FindConversationByDateInput
  ): Promise<string | null> {
    const conversation = await this.conversationRepository.findByUserContactDate(
      input.userId,
      input.contactId,
      input.dateKey
    );
    return conversation?.id ?? null;
  }

  async listConversationDateKeys(input: ListConversationDateKeysInput): Promise<string[]> {
    return this.messageRepository.listDateKeysByUserContactRange(input);
  }

  async listPracticeDateKeys(input: ListPracticeDateKeysInput): Promise<string[]> {
    return this.messageRepository.listPracticeDateKeysByUserRange(input);
  }

  async listConversationMessagesByDateRange(
    input: ListMessagesByDateRangeInput
  ): Promise<MessageView[]> {
    await this.assertConversationBelongsToUser(input.conversationId, input.userId);

    const fromStart = new Date(`${input.fromDateKey}T00:00:00+08:00`);
    const toEnd = new Date(`${input.toDateKey}T23:59:59.999+08:00`);

    const rows = await this.messageRepository.listByConversationRange({
      conversationId: input.conversationId,
      fromDateKey: input.fromDateKey,
      toDateKey: input.toDateKey,
      from: fromStart,
      to: toEnd,
      limit: 500,
    });

    return rows
      .filter((row) => row.status !== "failed")
      .map((row) => this.toView(row));
  }

  async listDayMessagesPage(input: ListDayMessagesPageInput): Promise<ListDayMessagesPageResult> {
    await this.assertConversationBelongsToUser(input.conversationId, input.userId);

    const dayStart = new Date(`${input.dateKey}T00:00:00+08:00`);
    const dayEnd = new Date(`${input.dateKey}T23:59:59.999+08:00`);
    const beforeCreatedAt = input.beforeCreatedAt ? new Date(input.beforeCreatedAt) : undefined;

    const rows = await this.messageRepository.listByConversationDayPage({
      conversationId: input.conversationId,
      from: dayStart,
      to: dayEnd,
      dateKey: input.dateKey,
      limit: input.limit,
      beforeCreatedAt,
      beforeId: input.beforeId,
    });

    const itemsDesc = rows.map((row) => this.toView(row));
    const itemsAsc = itemsDesc.slice().reverse();
    const tail = itemsDesc[itemsDesc.length - 1];

    return {
      items: itemsAsc,
      nextCursor:
        itemsDesc.length < input.limit || !tail
          ? null
          : {
              beforeCreatedAt: tail.createdAt,
              beforeId: tail.id,
            },
    };
  }

  async updateMessageCloze(input: UpdateMessageClozeInput): Promise<UpdateMessageClozeResult> {
    const message = await this.messageRepository.findById(input.messageId);
    if (!message || message.userId !== input.userId || message.role !== "assistant") {
      throw new MessageAccessDeniedError();
    }

    const normalized = normalizeClozeState(input.clozeState, message.content);
    const result = await this.messageRepository.updateClozeState({
      messageId: input.messageId,
      baseVersion: Math.max(0, Math.floor(input.baseVersion)),
      clozeState: normalized,
    });

    const latest = {
      clozeState: result.message.clozeState ?? null,
      clozeVersion: result.message.clozeVersion,
    };
    if (!result.ok) {
      throw new MessageClozeConflictError(latest);
    }
    return latest;
  }

  async discardClozePractice(input: {
    userId: string;
    messageId: string;
  }): Promise<DiscardClozePracticeResult> {
    const message = await this.messageRepository.findById(input.messageId);
    if (!message || message.userId !== input.userId || message.role !== "assistant") {
      throw new MessageAccessDeniedError();
    }

    const updated = await this.messageRepository.discardClozePractice(input.messageId);
    return {
      messageId: updated.id,
      clozePracticeDiscardedAt: (updated.clozePracticeDiscardedAt ?? new Date()).toISOString(),
    };
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
    clozeState?: ClozeState | null;
    clozeVersion?: number;
    clozePracticeDiscardedAt?: Date | null;
    conversationDateKey?: string | null;
    createdAt: Date;
  }): MessageView {
    return {
      id: row.id,
      role: row.role,
      status: row.status,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      conversationDateKey: row.conversationDateKey ?? null,
      clozeState: row.clozeState ?? null,
      clozeVersion: Number.isFinite(row.clozeVersion) ? Number(row.clozeVersion) : 0,
      clozePracticeDiscardedAt: row.clozePracticeDiscardedAt?.toISOString() ?? null,
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

function normalizeClozeState(input: ClozeState | null, messageContent: string): ClozeState | null {
  if (input === null) return null;
  if (!input || typeof input !== "object") {
    throw new InvalidClozeStateError();
  }
  const rawGroups = Array.isArray(input.groups) ? input.groups : null;
  if (!Array.isArray(rawGroups) || !Array.isArray(input.correctTokenIndexes)) {
    throw new InvalidClozeStateError();
  }

  const used = new Set<number>();
  const blankUsed = new Set<number>();
  const tokenCount = tokenizeForCloze(messageContent).length;
  const groups = rawGroups.map((group) => {
    if (!group || typeof group !== "object") throw new InvalidClozeStateError();
    if (!Array.isArray(group.tokenIndexes) || !Array.isArray(group.blankTokenIndexes)) {
      throw new InvalidClozeStateError();
    }
    const tokenIndexes: number[] = [];
    const local = new Set<number>();
    for (const raw of group.tokenIndexes) {
      if (!Number.isInteger(raw) || raw < 0 || raw >= tokenCount) throw new InvalidClozeStateError();
      const value = Number(raw);
      if (local.has(value) || used.has(value)) throw new InvalidClozeStateError();
      local.add(value);
      used.add(value);
      tokenIndexes.push(value);
    }
    if (!tokenIndexes.length) throw new InvalidClozeStateError();

    const tokenSet = new Set(tokenIndexes);
    const blankTokenIndexes: number[] = [];
    const blankLocal = new Set<number>();
    for (const raw of group.blankTokenIndexes) {
      if (!Number.isInteger(raw) || raw < 0 || raw >= tokenCount) throw new InvalidClozeStateError();
      const value = Number(raw);
      if (blankLocal.has(value) || !tokenSet.has(value)) throw new InvalidClozeStateError();
      blankLocal.add(value);
      blankUsed.add(value);
      blankTokenIndexes.push(value);
    }
    return {
      tokenIndexes: tokenIndexes.sort((a, b) => a - b),
      blankTokenIndexes: blankTokenIndexes.sort((a, b) => a - b),
    };
  });

  const correctLocal = new Set<number>();
  const correctTokenIndexes = input.correctTokenIndexes.map((raw) => {
    if (!Number.isInteger(raw) || raw < 0 || raw >= tokenCount) throw new InvalidClozeStateError();
    const value = Number(raw);
    if (correctLocal.has(value) || !blankUsed.has(value)) throw new InvalidClozeStateError();
    correctLocal.add(value);
    return value;
  }).sort((a, b) => a - b);

  if (!groups.length) return null;
  return { groups, correctTokenIndexes };
}

function tokenizeForCloze(text: string): Array<{ start: number; end: number }> {
  const tokens: Array<{ start: number; end: number }> = [];
  const tokenRe = /[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]/gu;
  for (const match of text.matchAll(tokenRe)) {
    const value = match[0] ?? "";
    const start = match.index ?? 0;
    if (!value) continue;
    tokens.push({ start, end: start + value.length });
  }
  return tokens;
}
