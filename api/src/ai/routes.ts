import type { FastifyInstance } from "fastify";
import type { OioAiService, OioAiStreamEvent } from "@lf/server/services/ai/OioAiService.js";
import { ContentSafetyBlockedError } from "@lf/server/services/contentSafety/ContentSafetyService.js";
import { resolveRequestId } from "../lib/httpResult.js";
import { AccountDisabledError, resolveActiveUserContext, UnauthorizedError } from "../auth/userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";

export interface OioAiRouteDeps {
  oioAiService: OioAiService;
  userRepository: Parameters<typeof resolveActiveUserContext>[0]["userRepository"];
  systemEventLogRepository: SystemEventLogWriter;
}

type StreamBody = { text: string; threadId?: string; contextCardId?: string; appLocale?: string; today?: string };

function isStreamBody(value: unknown): value is StreamBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const optional = (key: string, max: number) => body[key] === undefined || body[key] === null || (typeof body[key] === "string" && (body[key] as string).length <= max);
  return typeof body.text === "string" && body.text.trim().length > 0 && body.text.length <= 1_000
    && optional("threadId", 64) && optional("contextCardId", 200) && optional("appLocale", 20) && optional("today", 10);
}

const ERROR_STATUS: Record<string, number> = {
  OIO_AI_MEMBERS_ONLY: 403,
  OIO_AI_THREAD_NOT_FOUND: 404,
  TOKEN_QUOTA_EXCEEDED: 402,
  CONTENT_BLOCKED: 400,
  REQUEST_INVALID: 400,
  RATE_LIMITED: 429,
};

function errorCode(error: unknown): string {
  if (error instanceof ContentSafetyBlockedError) return "CONTENT_BLOCKED";
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "INTERNAL_ERROR";
}

function serverToday(): string {
  // Beijing time: most users; the app normally sends its own local date.
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** OIO AI (2026-11): members-only, tool-calling assistant over the user's cards. */
export function registerOioAiRoutes(app: FastifyInstance, deps: OioAiRouteDeps): void {
  async function authenticate(authorization: string | undefined) {
    return resolveActiveUserContext({ authorization, userRepository: deps.userRepository });
  }

  function authError(error: unknown): { status: number; code: string; message: string } | null {
    if (error instanceof UnauthorizedError || error instanceof AccountDisabledError) {
      return { status: error instanceof UnauthorizedError ? 401 : 403, code: error.code, message: error.message };
    }
    return null;
  }

  app.post("/ai/chat/stream", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const body = req.body as unknown;
    if (!isStreamBody(body)) return reply.status(400).send({ ok: false, error: { code: "REQUEST_INVALID", message: "Invalid OIO AI request" } });
    let userId: string;
    try {
      userId = (await authenticate(req.headers.authorization)).userId;
      // Membership is checked here as well, before the stream opens (the app's own check is not enough).
      await deps.oioAiService.assertMember(userId);
    } catch (error) {
      const auth = authError(error);
      if (auth) return reply.status(auth.status).send({ ok: false, error: { code: auth.code, message: auth.message } });
      const code = errorCode(error);
      return reply.status(ERROR_STATUS[code] ?? 500).send({ ok: false, error: { code, message: code } });
    }

    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("x-request-id", requestId);
    reply.raw.flushHeaders?.();
    const abort = new AbortController();
    reply.raw.on("close", () => { if (!reply.raw.writableEnded) abort.abort(); });
    const write = async (event: OioAiStreamEvent | { type: "error"; code: string }) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await deps.oioAiService.chatStream({
        userId,
        requestId,
        text: body.text,
        threadId: body.threadId ?? undefined,
        contextCardId: body.contextCardId ?? undefined,
        appLocale: body.appLocale ?? undefined,
        today: /^\d{4}-\d{2}-\d{2}$/u.test(body.today ?? "") ? body.today! : serverToday(),
        signal: abort.signal,
      }, write);
    } catch (error) {
      const code = errorCode(error);
      await write({ type: "error", code });
      if (!ERROR_STATUS[code]) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId, userId, module: "oio_ai", event: "oio_ai.stream.failed", level: "error", status: "failed",
          errorCode: code, errorMessage: error instanceof Error ? error.message : String(error), metadata: { path: "/ai/chat/stream" },
        });
        req.log.error({ requestId, code, err: error }, "oio ai stream failed");
      }
    }
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    return reply;
  });

  app.get("/ai/threads", async (req, reply) => {
    try {
      const { userId } = await authenticate(req.headers.authorization);
      return { ok: true, data: { threads: await deps.oioAiService.listThreads(userId) } };
    } catch (error) {
      const auth = authError(error);
      if (auth) return reply.status(auth.status).send({ ok: false, error: { code: auth.code, message: auth.message } });
      throw error;
    }
  });

  app.get("/ai/threads/:threadId/messages", async (req, reply) => {
    try {
      const { userId } = await authenticate(req.headers.authorization);
      const { threadId } = req.params as { threadId: string };
      return { ok: true, data: { messages: await deps.oioAiService.listMessages(userId, threadId) } };
    } catch (error) {
      const auth = authError(error);
      if (auth) return reply.status(auth.status).send({ ok: false, error: { code: auth.code, message: auth.message } });
      const code = errorCode(error);
      if (ERROR_STATUS[code]) return reply.status(ERROR_STATUS[code]!).send({ ok: false, error: { code, message: code } });
      throw error;
    }
  });
}
