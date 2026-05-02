import type { FastifyInstance } from "fastify";
import type { ChatMessageService } from "@lf/server-next/services/chat/ChatMessageService.js";
import { resolveRequestId } from "../lib/httpResult.js";

type SendMessageBody = {
  userId: string;
  contactId: string;
  text: string;
};

type ListMessagesQuery = {
  conversationId: string;
};

type ListMessagesRangeQuery = {
  conversationId: string;
  userId: string;
  fromDateKey?: string;
  toDateKey?: string;
};

export interface ChatRouteDeps {
  chatMessageService: ChatMessageService;
  userRepository: {
    findById: (userId: string) => Promise<{ id: string } | null>;
    ensureUserExists: (input: {
      id: string;
      nickname?: string | null;
      avatarUrl?: string | null;
      status?: "active" | "disabled";
    }) => Promise<void>;
  };
}

function isSendMessageBody(value: unknown): value is SendMessageBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    v.userId.trim().length > 0 &&
    typeof v.contactId === "string" &&
    v.contactId.trim().length > 0 &&
    typeof v.text === "string" &&
    v.text.trim().length > 0
  );
}

export function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): void {
  // 发用户消息（先落库 pending）
  app.post("/chat/messages", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (isSendMessageBody(body)) {
      req.log.info({ requestId, userId: body.userId }, "chat/messages incoming userId");
    }
    
    if (!isSendMessageBody(body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid message payload" },
      });
    }

    const user = await deps.userRepository.findById(body.userId);
    req.log.info({ requestId, userId: body.userId, exists: !!user }, "user exists before conversation.create");

    if (!user) {
      await deps.userRepository.ensureUserExists({
        id: body.userId,
        nickname: "Mock User",
        avatarUrl: null,
        status: "active",
      });
    }

    const data = await deps.chatMessageService.sendUserMessage({
      userId: body.userId,
      contactId: body.contactId,
      text: body.text,
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  // 查某会话历史
  app.get("/chat/messages", async (req, reply) => {
    const query = req.query as Partial<ListMessagesQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const conversationId = query.conversationId?.trim();


    if (!conversationId) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "conversationId is required" },
      });
    }

    const data = await deps.chatMessageService.listConversationMessages(conversationId);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  // 按日期范围查会话历史：未传范围时，mock_user_001 默认按近30天（pro）
  app.get("/chat/messages/range", async (req, reply) => {
    const query = req.query as Partial<ListMessagesRangeQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const conversationId = query.conversationId?.trim();
    const userId = query.userId?.trim();

    if (!conversationId || !userId) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "conversationId and userId are required" },
      });
    }

    const isMockProUser = userId === "mock_user_001";
    const now = new Date();
    const defaultFrom = formatDateKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - (isMockProUser ? 29 : 3650))
    );
    const defaultTo = formatDateKey(now);

    const fromDateKey = query.fromDateKey?.trim() || defaultFrom;
    const toDateKey = query.toDateKey?.trim() || defaultTo;

    const data = await deps.chatMessageService.listConversationMessagesByDateRange({
      conversationId,
      fromDateKey,
      toDateKey,
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
