import type { FastifyInstance } from "fastify";
import {
  ConversationAccessDeniedError,
  type ChatMessageService,
} from "@lf/server-next/services/chat/ChatMessageService.js";
import { resolveRequestId } from "../lib/httpResult.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { getRuntimeConfig } from "@lf/server-next/config/runtimeConfig.js";

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

type FindConversationByDateQuery = {
  dateKey: string;
  contactId?: string;
};

type ListDayPageQuery = {
  conversationId: string;
  dateKey: string;
  userId?: string;
  limit?: string;
  beforeCreatedAt?: string;
  beforeId?: string;
};

export interface ChatRouteDeps {
  chatMessageService: ChatMessageService;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled";
    } | null>;
    ensureUserExists: (input: {
      id: string;
      nickname?: string | null;
      avatarUrl?: string | null;
      status?: "active" | "disabled";
    }) => Promise<void>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
  entitlementService :{
    assertCanUse: (userId: string, requestedChars: number) => Promise<void>;
  };
  rateLimiter: {
    consume: (key: string, limit: number, windowMs: number) => Promise<boolean>;
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
  const runtimeConfig = getRuntimeConfig();

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

    // 超出输入的字符最大上限拦截
    if (body.text.trim().length > runtimeConfig.rewriteMaxInputChars) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "over max input chars" },
      });
    }


    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: body.userId,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/chat/messages" },
        });
        return reply.status(403).send({
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

    const textLen = body.text.trim().length;
    try {
      await deps.entitlementService.assertCanUse(userContext.userId, textLen);
    } catch (error) {
      if(
        typeof error === "object" &&
        error != null &&
        "code" in error &&
        String((error as {code : unknown}).code) === "DAILY_QUOTA_EXCEEDED"
      ){
        return reply.status(429).send({
          ok: false,
          request_id: requestId,
          error: {code: "DAILY_QUOTA_EXCEEDED", message: "You've reached your daily quota for today."}
        });
      }
      throw error;
    }

    const windowMs = runtimeConfig.chatMessagesUserRateWindowMs;
    const limit = runtimeConfig.chatMessagesUserRateLimit;
    const bucket = Math.floor(Date.now() / windowMs);
    const key = `chat:messages:user:${userContext.userId}:${bucket}`;
    const allowed = await deps.rateLimiter.consume(key, limit, windowMs);

    if (!allowed) {
      return reply.status(429).send({
        ok: false,
        request_id: requestId,
        error: { code: "RATE_LIMITED", message: "You're sending requests too quickly. Please try again later." },
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
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: query.userId ?? null,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/chat/messages" },
        });
        return reply.status(403).send({
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
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: query.userId ?? null,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/chat/messages/range" },
        });
        return reply.status(403).send({
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

  app.get("/chat/conversation/by-date", async (req, reply) => {
    const query = req.query as Partial<FindConversationByDateQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const dateKey = query.dateKey?.trim();
    const contactId = query.contactId?.trim() || "rewrite_assistant";

    if (!dateKey) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "dateKey is required" },
      });
    }

    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: null,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/chat/conversation/by-date" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    const conversationId = await deps.chatMessageService.findConversationIdByUserContactDate({
      userId: userContext.userId,
      contactId,
      dateKey,
    });

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: { conversationId },
    });
  });

  app.get("/chat/messages/day-page", async (req, reply) => {
    const query = req.query as Partial<ListDayPageQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const conversationId = query.conversationId?.trim();
    const dateKey = query.dateKey?.trim();
    const limitRaw = Number(query.limit ?? "30");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30;
    const beforeCreatedAt = query.beforeCreatedAt?.trim();
    const beforeId = query.beforeId?.trim();

    if (!conversationId || !dateKey) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "conversationId and dateKey are required" },
      });
    }

    let userContext;
    try {
      userContext = await resolveActiveUserContext({
        authorization: req.headers.authorization,
        userRepository: deps.userRepository,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof AccountDisabledError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: null,
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/chat/messages/day-page" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }

    try {
      const data = await deps.chatMessageService.listDayMessagesPage({
        conversationId,
        userId: userContext.userId,
        dateKey,
        limit,
        beforeCreatedAt,
        beforeId,
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
