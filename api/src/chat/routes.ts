import type { FastifyInstance } from "fastify";
import {
  ConversationAccessDeniedError,
  InvalidClozeStateError,
  MessageAccessDeniedError,
  MessageClozeConflictError,
  type ChatMessageService,
} from "@lf/server/services/chat/ChatMessageService.js";
import { resolveRequestId } from "../lib/httpResult.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";

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

type ListConversationDateKeysQuery = {
  contactId?: string;
  fromDateKey?: string;
  toDateKey?: string;
};

type ListPracticeDateKeysQuery = {
  contactIds?: string;
  fromDateKey?: string;
  toDateKey?: string;
};

type ListDayPageQuery = {
  conversationId: string;
  dateKey: string;
  userId?: string;
  limit?: string;
  beforeCreatedAt?: string;
  beforeId?: string;
};

type UpdateClozeBody = {
  messageId: string;
  baseVersion: number;
  clozeState: {
    groups: Array<{
      tokenIndexes: number[];
      blankTokenIndexes: number[];
    }>;
    correctTokenIndexes: number[];
  } | null;
};

type DiscardClozePracticeBody = {
  messageId: string;
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
    getCurrentEntitlement: (userId: string) => Promise<{ isPro: boolean }>;
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

function isUpdateClozeBody(value: unknown): value is UpdateClozeBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.messageId === "string" &&
    v.messageId.trim().length > 0 &&
    Number.isFinite(v.baseVersion) &&
    (v.clozeState === null || typeof v.clozeState === "object")
  );
}

// 练习丢弃目前只需要 messageId；用户身份和 assistant-message 约束在 service 层校验。
function isDiscardClozePracticeBody(value: unknown): value is DiscardClozePracticeBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.messageId === "string" && v.messageId.trim().length > 0;
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

    const inputLength = body.text.trim().length;
    if (inputLength < runtimeConfig.chatGenerationMinInputChars) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "under min input chars" },
      });
    }

    if (inputLength > runtimeConfig.chatGenerationMaxInputChars) {
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
      await assertProCloudAccess(deps, userContext.userId);
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
          error: {code: "DAILY_QUOTA_EXCEEDED", message: "You've reached your character quota."}
        });
      }
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.listConversationMessages({
        conversationId,
        userId: userContext.userId,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.listConversationMessagesByDateRange({
        conversationId,
        userId: userContext.userId,
        fromDateKey,
        toDateKey,
      });

      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
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

    let conversationId: string | null;
    try {
      await assertProCloudAccess(deps, userContext.userId);
      conversationId = await deps.chatMessageService.findConversationIdByUserContactDate({
        userId: userContext.userId,
        contactId,
        dateKey,
      });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
      throw error;
    }

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: { conversationId },
    });
  });

  app.get("/chat/conversations/date-keys", async (req, reply) => {
    const query = req.query as Partial<ListConversationDateKeysQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const contactId = query.contactId?.trim() || "rewrite_assistant";
    const fromDateKey = query.fromDateKey?.trim();
    const toDateKey = query.toDateKey?.trim();

    if (!fromDateKey || !toDateKey) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "fromDateKey and toDateKey are required" },
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
          metadata: { path: "/chat/conversations/date-keys" },
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.listConversationDateKeys({
        userId: userContext.userId,
        contactId,
        fromDateKey,
        toDateKey,
      });

      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
      throw error;
    }
  });

  // 练习页日历只需要按天聚合后的正确率；真正进入某天练习时再拉消息。
  app.get("/chat/practice/day-stats", async (req, reply) => {
    const query = req.query as Partial<ListPracticeDateKeysQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const contactIds = (query.contactIds ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const fromDateKey = query.fromDateKey?.trim();
    const toDateKey = query.toDateKey?.trim();

    if (!contactIds.length || !fromDateKey || !toDateKey) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "contactIds, fromDateKey and toDateKey are required" },
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
          metadata: { path: "/chat/practice/day-stats" },
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.listPracticeDayStats({
        userId: userContext.userId,
        contactIds,
        fromDateKey,
        toDateKey,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
      throw error;
    }
  });

  // 兼容旧客户端：只拿“哪些天有练习”。
  app.get("/chat/practice/date-keys", async (req, reply) => {
    const query = req.query as Partial<ListPracticeDateKeysQuery>;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const contactIds = (query.contactIds ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const fromDateKey = query.fromDateKey?.trim();
    const toDateKey = query.toDateKey?.trim();

    if (!contactIds.length || !fromDateKey || !toDateKey) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "contactIds, fromDateKey and toDateKey are required" },
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
          metadata: { path: "/chat/practice/date-keys" },
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.listPracticeDateKeys({
        userId: userContext.userId,
        contactIds,
        fromDateKey,
        toDateKey,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
      throw error;
    }
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
      await assertProCloudAccess(deps, userContext.userId);
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
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
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

  // 保存挖空状态：聊天页新增/删除挖空，以及练习页答对空，最终都走这个接口。
  app.patch("/chat/messages/cloze", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isUpdateClozeBody(body)) {
      await logClozeSaveFailure(deps.systemEventLogRepository, {
        requestId,
        userId: null,
        errorCode: "VALIDATION_FAILED",
        errorMessage: "Invalid cloze payload",
        metadata: { reason: "invalid_payload" },
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid cloze payload" },
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
          metadata: { path: "/chat/messages/cloze" },
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.updateMessageCloze({
        userId: userContext.userId,
        messageId: body.messageId.trim(),
        baseVersion: Math.max(0, Math.floor(Number(body.baseVersion))),
        clozeState: body.clozeState,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
      if (error instanceof MessageClozeConflictError) {
        await logClozeSaveFailure(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          errorCode: error.code,
          errorMessage: error.message,
          metadata: buildClozeSaveFailureMetadata(body, {
            latestVersion: error.latest.clozeVersion,
            reason: "version_conflict",
          }),
        });
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
          data: error.latest,
        });
      }
      if (error instanceof InvalidClozeStateError) {
        await logClozeSaveFailure(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          errorCode: error.code,
          errorMessage: error.message,
          metadata: buildClozeSaveFailureMetadata(body, { reason: "invalid_state" }),
        });
        return reply.status(400).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      if (error instanceof MessageAccessDeniedError) {
        await logClozeSaveFailure(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          errorCode: error.code,
          errorMessage: error.message,
          metadata: buildClozeSaveFailureMetadata(body, { reason: "message_access_denied" }),
        });
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      await logClozeSaveFailure(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        errorCode: "CLOZE_SAVE_FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown cloze save failure",
        metadata: buildClozeSaveFailureMetadata(body, { reason: "unexpected_error" }),
      });
      throw error;
    }
  });

  // 练习卡右滑丢弃：写入 message.clozePracticeDiscardedAt，之后所有练习入口统一过滤。
  app.patch("/chat/messages/cloze-practice-discard", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isDiscardClozePracticeBody(body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid discard payload" },
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
          metadata: { path: "/chat/messages/cloze-practice-discard" },
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
      await assertProCloudAccess(deps, userContext.userId);
      const data = await deps.chatMessageService.discardClozePractice({
        userId: userContext.userId,
        messageId: body.messageId.trim(),
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (isProRequiredError(error)) {
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: "PRO_REQUIRED", message: "Pro access required" },
        });
      }
      if (error instanceof MessageAccessDeniedError) {
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

async function assertProCloudAccess(deps: ChatRouteDeps, userId: string): Promise<void> {
  const entitlement = await deps.entitlementService.getCurrentEntitlement(userId);
  if (entitlement.isPro) return;
  const error = new Error("Pro access required") as Error & { code: string; statusCode: number };
  error.code = "PRO_REQUIRED";
  error.statusCode = 403;
  throw error;
}

function isProRequiredError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "PRO_REQUIRED";
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function logClozeSaveFailure(
  systemEventLogRepository: SystemEventLogWriter | undefined,
  input: {
    requestId: string;
    userId: string | null;
    errorCode: string;
    errorMessage: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await writeSystemEventLog(systemEventLogRepository, {
    requestId: input.requestId,
    userId: input.userId,
    module: "chat",
    event: "chat.cloze.save_failed",
    level: "warn",
    status: "failed",
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    metadata: {
      path: "/chat/messages/cloze",
      ...input.metadata,
    },
  });
}

function buildClozeSaveFailureMetadata(
  body: UpdateClozeBody,
  extra: Record<string, unknown>
): Record<string, unknown> {
  return {
    messageId: body.messageId,
    baseVersion: body.baseVersion,
    hasClozeState: body.clozeState !== null,
    groupCount: body.clozeState?.groups.length ?? 0,
    ...extra,
  };
}
