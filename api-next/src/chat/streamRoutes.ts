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

    try {
      await deps.rewriteService.rewriteStream(
        {
          text: body.text,
          userId: userContext.userId,
          systemPrompt: body.systemPrompt ?? undefined,
          conversationId:body.conversationId,
          userMessageId:body.userMessageId,
          requestId,
          signal: abortController.signal,
        },
        writeEvent
      );

      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
      const message = error instanceof Error ? error.message : "Unknown stream error";
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(toSseChunk({ type: "error", message, code }));
        reply.raw.end();
      }
    }
  });
}
