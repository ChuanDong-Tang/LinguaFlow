import type { FastifyInstance } from "fastify";
import type { RewriteStreamEvent, RewriteStreamRequestBody } from "@lf/core/contracts/chatStream.js";
import type { AbortSignalLike } from "@lf/core/ports/ai/AIProvider.js";
import { resolveRequestId } from "../lib/httpResult.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import type { ChatMessageService } from "@lf/server-next/services/chat/ChatMessageService.js";

export interface ChatStreamRouteDeps {
  rewriteService: {
    rewriteStream: (
      input: RewriteStreamRequestBody & { requestId: string; signal?: AbortSignalLike },
      onEvent: (event: RewriteStreamEvent) => Promise<void> | void
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

function isRewriteStreamBody(value: unknown): value is RewriteStreamRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.text === "string" &&
    v.text.trim().length > 0 &&
    typeof v.userId === "string" &&
    v.userId.trim().length > 0 &&
    typeof v.conversationId === "string" &&
    v.conversationId.trim().length > 0 &&
    typeof v.userMessageId === "string" &&
    v.userMessageId.trim().length > 0 &&
    (v.systemPrompt === undefined || v.systemPrompt === null || typeof v.systemPrompt === "string")
  );
}

function toSseChunk(event: RewriteStreamEvent): string {
  return `event: message\ndata: ${JSON.stringify(event)}\n\n`;
}

export function registerChatStreamRoutes(app: FastifyInstance, deps: ChatStreamRouteDeps): void {
  app.post("/chat/rewrite/stream", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);

    if (!isRewriteStreamBody(body)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid rewrite stream payload" },
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
          metadata: { path: "/chat/rewrite/stream" },
        });
        return reply.status(403).send({
          ok: false,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    try {
      // Validate ownership before switching to SSE response.
      await deps.chatMessageService.assertUserMessageOwnership({
        userId: userContext.userId,
        conversationId: body.conversationId,
        userMessageId: body.userMessageId,
      });

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

      const writeEvent = async (event: RewriteStreamEvent) => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(toSseChunk(event));
      };

      await deps.rewriteService.rewriteStream(
        {
          text: body.text,
          userId: userContext.userId,
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
      if (
        code === "MESSAGE_NOT_FOUND" ||
        code === "CONVERSATION_NOT_FOUND"
      ) {
        return reply.status(404).send({
          ok: false,
          error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" },
        });
      }
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "chat",
        event: "chat.rewrite.stream.failed",
        level: "error",
        status: "failed",
        errorCode: code ?? "INTERNAL_ERROR",
        errorMessage: message,
        metadata: {
          path: "/chat/rewrite/stream",
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
        "rewrite stream failed"
      );
      const safeCode = code === "UPSTREAM_AI_ERROR" ? "UPSTREAM_AI_ERROR" : (code ?? "INTERNAL_ERROR");
      const safeMessage =
        code === "UPSTREAM_AI_ERROR"
          ? "AI service is temporarily unavailable"
          : "Stream failed";
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        // If SSE already started, write structured stream error; otherwise return JSON 500.
        const contentType = String(reply.raw.getHeader("Content-Type") ?? "");
        if (contentType.includes("text/event-stream")) {
          reply.raw.write(toSseChunk({ type: "error", message: safeMessage, code: safeCode }));
          reply.raw.end();
        } else {
          return reply.status(code === "UPSTREAM_AI_ERROR" ? 503 : 500).send({
            ok: false,
            error: { code: safeCode, message: safeMessage },
          });
        }
      }
    }
  });
}
