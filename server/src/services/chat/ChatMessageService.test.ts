import assert from "node:assert/strict";
import test from "node:test";
import type { CreateMessageInput, MessageEntity } from "@lf/core/ports/repository/MessageRepository.js";
import { ChatMessageService } from "./ChatMessageService.js";

test("persists the mobile assistant client id on the cloud message", async () => {
  const createdInputs: CreateMessageInput[] = [];
  const service = new ChatMessageService(
    {
      findById: async () => ({ id: "conversation-1", userId: "user-1", dateKey: "2026-07-14" }),
    } as any,
    {
      findAssistantBySourceMessageId: async () => null,
      create: async (input: CreateMessageInput): Promise<MessageEntity> => {
        createdInputs.push(input);
        return {
          id: "assistant-server-1",
          conversationId: input.conversationId,
          userId: input.userId,
          role: input.role,
          status: input.status ?? "pending",
          content: input.content,
          inputChars: input.inputChars ?? 0,
          outputChars: input.outputChars ?? 0,
          clientId: input.clientId ?? null,
          sourceMessageId: input.sourceMessageId ?? null,
          clozeState: null,
          clozeVersion: 0,
          clozePracticeDiscardedAt: null,
          conversationDateKey: input.conversationDateKey ?? null,
          languageCode: input.languageCode ?? null,
          createdAt: new Date("2026-07-14T14:00:00.000Z"),
          updatedAt: new Date("2026-07-14T14:00:00.000Z"),
        };
      },
    } as any
  );

  const result = await service.createAssistantMessage(
    "conversation-1",
    "user-1",
    "Super healing",
    "user-message-1",
    "en-US",
    "local-assistant-1"
  );

  assert.equal(createdInputs[0]?.clientId, "local-assistant-1");
  assert.equal(result.clientId, "local-assistant-1");
});
