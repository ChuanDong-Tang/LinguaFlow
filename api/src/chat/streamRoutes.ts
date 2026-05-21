import type { FastifyInstance } from "fastify";
import type { ChatGenerationStreamEvent, ChatGenerationStreamRequestBody } from "@lf/core/contracts/chatStream.js";
import type { AbortSignalLike } from "@lf/core/ports/ai/AIProvider.js";
import { resolveRequestId } from "../lib/httpResult.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import type { ChatMessageService } from "@lf/server/services/chat/ChatMessageService.js";

export interface ChatStreamRouteDeps {
  chatGenerationService: {
    generateChatStream: (
      input: ChatGenerationStreamRequestBody & { requestId: string; signal?: AbortSignalLike },
      onEvent: (event: ChatGenerationStreamEvent) => Promise<void> | void
    ) => Promise<void>;
  };
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled";
    } | null>;
  };
  chatMessageService: ChatMessageService;
  systemEventLogRepository?: SystemEventLogWriter;
}

function isChatGenerationStreamBody(value: unknown): value is ChatGenerationStreamRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const hasConversationId = typeof v.conversationId === "string" && v.conversationId.trim().length > 0;
  const hasUserMessageId = typeof v.userMessageId === "string" && v.userMessageId.trim().length > 0;
  return (
    typeof v.text === "string" &&
    v.text.trim().length > 0 &&
    typeof v.userId === "string" &&
    v.userId.trim().length > 0 &&
    hasConversationId === hasUserMessageId &&
    (v.contactId === undefined || v.contactId === null || typeof v.contactId === "string") &&
    (v.systemPrompt === undefined || v.systemPrompt === null || typeof v.systemPrompt === "string")
  );
}

function toSseChunk(event: ChatGenerationStreamEvent): string {
  return `event: message\ndata: ${JSON.stringify(event)}\n\n`;
}

function mapChatGenerationErrorToHttp(code: string | undefined): {
  status: number;
  code: string;
  message: string;
} | null {
  if (code === "MESSAGE_NOT_FOUND" || code === "CONVERSATION_NOT_FOUND") {
    return { status: 404, code: "RESOURCE_NOT_FOUND", message: "Resource not found" };
  }
  if (code === "INPUT_TOO_LONG") {
    return { status: 400, code: "INPUT_TOO_LONG", message: "Input too long" };
  }
  if (code === "UPSTREAM_AI_ERROR") {
    return {
      status: 503,
      code: "UPSTREAM_AI_ERROR",
      message: "AI service is temporarily unavailable",
    };
  }
  if (code === "RATE_LIMITED") {
    return { status: 429, code: "RATE_LIMITED", message: "Too many requests" };
  }
  if (code === "TASK_IN_PROGRESS") {
    return {
      status: 409,
      code: "TASK_IN_PROGRESS",
      message: "A chat generation task is already running for this user.",
    };
  }
  return null;
}

export function registerChatStreamRoutes(app: FastifyInstance, deps: ChatStreamRouteDeps): void {
  app.post("/chat/generation/stream", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);

    if (!isChatGenerationStreamBody(body)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid chat generation stream payload" },
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
          metadata: { path: "/chat/generation/stream" },
        });
        return reply.status(403).send({
          ok: false,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    try {
      // Validate ownership before switching to SSE response when the caller
      // asks the stream to persist into cloud chat history.
      if (body.conversationId && body.userMessageId) {
        await deps.chatMessageService.assertUserMessageOwnership({
          userId: userContext.userId,
          conversationId: body.conversationId,
          userMessageId: body.userMessageId,
        });
      }

      // Start streaming only after preflight check passed.
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("x-request-id", requestId);
      reply.raw.flushHeaders?.();

      const abortController = new AbortController();
      reply.raw.on("close", () => {
        abortController.abort();
      });

      const writeEvent = async (event: ChatGenerationStreamEvent) => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(toSseChunk(event));
      };

      await deps.chatGenerationService.generateChatStream(
        {
          text: body.text,
          userId: userContext.userId,
          contactId: body.contactId?.trim() || "rewrite_assistant",
          systemPrompt: body.systemPrompt ?? undefined,
          conversationId: body.conversationId,
          userMessageId: body.userMessageId,
          requestId,
          signal: abortController.signal,
        },
        writeEvent
      );

      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
      const message = error instanceof Error ? error.message : "Unknown stream error";
      const upstreamStatus =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status?: unknown }).status
          : undefined;
      const upstreamText =
        typeof error === "object" && error !== null && "upstreamText" in error
          ? (error as { upstreamText?: unknown }).upstreamText
          : undefined;
      const mapped = mapChatGenerationErrorToHttp(code);
      const contentType = String(reply.raw.getHeader("Content-Type") ?? "");
      const sseStarted = contentType.includes("text/event-stream");
      if (mapped && mapped.status !== 503 && !sseStarted) {
        return reply.status(mapped.status).send({
          ok: false,
          error: { code: mapped.code, message: mapped.message },
        });
      }
      
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "chat",
        event: "chat.generation.stream.failed",
        level: "error",
        status: "failed",
        errorCode: code ?? "INTERNAL_ERROR",
        errorMessage: message,
        metadata: {
          path: "/chat/generation/stream",
          conversationId: body.conversationId,
          userMessageId: body.userMessageId,
          upstreamStatus,
          upstreamText:
            typeof upstreamText === "string"
              ? upstreamText.slice(0, 500)
              : upstreamText ?? null,
        },
      });
      req.log.error(
        {
          requestId,
          code,
          error: message,
          upstreamStatus,
          upstreamText:
            typeof upstreamText === "string"
              ? upstreamText.slice(0, 500)
              : upstreamText ?? null,
        },
        "chat generation stream failed"
      );
      const safeCode = mapped?.code ?? "INTERNAL_ERROR";
      const safeMessage = mapped?.message ?? "Stream failed";
      const safeStatus = mapped?.status ?? 500;
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        // If SSE already started, write structured stream error; otherwise return JSON 500.
        if (sseStarted) {
          reply.raw.write(toSseChunk({ type: "error", message: safeMessage, code: safeCode }));
          reply.raw.end();
        } else {
          return reply.status(safeStatus).send({
            ok: false,
            error: { code: safeCode, message: safeMessage },
          });
        }
      }
    }
  });
}
