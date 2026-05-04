import type { FastifyInstance } from "fastify";
import {
  ConversationAccessDeniedError,
  type ChatMessageService,
} from "@lf/server-next/services/chat/ChatMessageService.js";
import { resolveRequestId } from "../lib/httpResult.js";
import { resolveUserContext, UnauthorizedError } from "../auth/userContext.js";

type SendMessageBody = {
  userId: string;
  contactId: string;
  text: string;
};

type ListMessagesQuery = {
  conversationId: string;
  userId?: string;
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

    let userContext;
    try {
      userContext = resolveUserContext({
        authorization: req.headers.authorization,
        bodyUserId: body.userId,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    const user = await deps.userRepository.findById(userContext.userId);
    req.log.info(
      { requestId, userId: userContext.userId, source: userContext.source, exists: !!user },
      "user exists before conversation.create"
    );

    if (!user) {
      await deps.userRepository.ensureUserExists({
        id: userContext.userId,
        nickname: userContext.source === "mock" ? "Mock User" : null,
        avatarUrl: null,
        status: "active",
      });
    }

    const data = await deps.chatMessageService.sendUserMessage({
      userId: userContext.userId,
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

    let userContext;
    try {
      userContext = resolveUserContext({
        authorization: req.headers.authorization,
        bodyUserId: query.userId,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    try {
      const data = await deps.chatMessageService.listConversationMessages({
        conversationId,
        userId: userContext.userId,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (error instanceof ConversationAccessDeniedError) {
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }
  });

  // 按日期范围查会话历史：未传范围时默认查近30天
  app.get("/chat/messages/range", async (req, reply) => {
    const query = req.query as Partial<ListMessagesRangeQuery>;
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

    let userContext;
    try {
      userContext = resolveUserContext({
        authorization: req.headers.authorization,
        bodyUserId: query.userId,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    req.log.info(
      { requestId, userId: userContext.userId, source: userContext.source },
      "chat/messages/range resolved user context"
    );

    const now = new Date();
    const defaultFrom = formatDateKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
    );
    const defaultTo = formatDateKey(now);

    const fromDateKey = query.fromDateKey?.trim() || defaultFrom;
    const toDateKey = query.toDateKey?.trim() || defaultTo;

    try {
      const data = await deps.chatMessageService.listConversationMessagesByDateRange({
        conversationId,
        userId: userContext.userId,
        fromDateKey,
        toDateKey,
      });

      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (error instanceof ConversationAccessDeniedError) {
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }
  });
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
