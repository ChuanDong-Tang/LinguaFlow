import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JournalService } from "@lf/server/services/journal/JournalService.js";
import type { JournalImageService } from "@lf/server/services/journal/JournalImageService.js";
import {
  JournalImageModerationUnavailableError,
  JournalImageProcessingUnavailableError,
} from "@lf/server/services/journal/JournalImageService.js";
import {
  JournalNotFoundError,
  JournalImageNotReadyError,
  JournalClientIdConsumedError,
  JournalTaskInProgressError,
  JournalValidationError,
  JournalPracticeConflictError,
} from "@lf/server/services/journal/JournalService.js";
import type { CreateJournalEntryInput, UpdateJournalClozeInput } from "@lf/core/types/journal.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";

export interface JournalRouteDeps {
  journalService: JournalService;
  journalImageService: JournalImageService;
  journalEnabled: boolean;
  rateLimiter?: { consume(key: string, limit: number, windowMs: number): Promise<boolean> };
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

export function registerJournalRoutes(app: FastifyInstance, deps: JournalRouteDeps): void {
  app.post("/journal/bootstrap", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/bootstrap");
    if (!userId) return;
    const body = req.body as { hasLegacyLocalHistory?: unknown } | null;
    const data = await deps.journalService.bootstrap(userId, body?.hasLegacyLocalHistory === true);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.post("/journal/entries", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/entries");
    if (!userId) return;
    const body = req.body as Partial<CreateJournalEntryInput> | null;
    if (!body || typeof body.clientId !== "string" || typeof body.originalText !== "string") {
      return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid journal entry");
    }
    try {
      const data = await deps.journalService.create({
        userId,
        requestId,
        body: {
          clientId: body.clientId,
          originalText: body.originalText,
          imageUploadId: typeof body.imageUploadId === "string" ? body.imageUploadId : null,
        },
      });
      return reply.status(202).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.post("/journal/image-uploads", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/image-uploads");
    if (!userId) return;
    if (deps.rateLimiter && !await deps.rateLimiter.consume(`journal:image-upload:${userId}`, 20, 3_600_000)) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "图片处理过于频繁，请稍后再试");
    }
    const body = req.body as { mimeType?: unknown; fileSize?: unknown; width?: unknown; height?: unknown } | null;
    try {
      const data = await deps.journalImageService.createUpload({
        userId,
        mimeType: String(body?.mimeType ?? ""),
        fileSize: Number(body?.fileSize),
        width: Number(body?.width),
        height: Number(body?.height),
      });
      return reply.status(201).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleJournalError(reply, requestId, error); }
  });

  app.post("/journal/image-uploads/:uploadId/complete", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/image-uploads/:uploadId/complete");
    if (!userId) return;
    try {
      const data = await deps.journalImageService.complete(userId, String((req.params as { uploadId?: unknown }).uploadId ?? ""));
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleJournalError(reply, requestId, error); }
  });

  app.get("/journal/image-uploads/:uploadId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/image-uploads/:uploadId");
    if (!userId) return;
    try {
      const data = await deps.journalImageService.status(userId, String((req.params as { uploadId?: unknown }).uploadId ?? ""));
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleJournalError(reply, requestId, error); }
  });

  app.delete("/journal/image-uploads/:uploadId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/image-uploads/:uploadId");
    if (!userId) return;
    await deps.journalImageService.remove(userId, String((req.params as { uploadId?: unknown }).uploadId ?? ""));
    return reply.status(204).send();
  });

  app.get("/journal/records", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/records");
    if (!userId) return;
    const dateKey = String((req.query as { dateKey?: unknown })?.dateKey ?? "");
    try {
      const data = await deps.journalService.listDate(userId, dateKey);
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.get("/journal/practice/queue", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/practice/queue");
    if (!userId) return;
    const limit = Number((req.query as { limit?: unknown })?.limit ?? 20);
    const data = await deps.journalService.practiceQueue(userId, limit);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.put("/journal/practice/:sourceKind/:sourceId/dictation", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/practice/:sourceKind/:sourceId/dictation");
    if (!userId) return;
    const params = req.params as { sourceKind?: unknown; sourceId?: unknown };
    const sourceKind = String(params.sourceKind ?? "");
    const sourceId = String(params.sourceId ?? "");
    const body = req.body as { result?: unknown } | null;
    try {
      const data = await deps.journalService.updateDictation(
        userId,
        `${sourceKind}:${sourceId}`,
        String(body?.result ?? "") as "correct" | "incorrect" | "revealed",
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.put("/journal/practice/:sourceKind/:sourceId/cloze", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/practice/:sourceKind/:sourceId/cloze");
    if (!userId) return;
    const params = req.params as { sourceKind?: unknown; sourceId?: unknown };
    try {
      const data = await deps.journalService.updateCloze(
        userId,
        `${String(params.sourceKind ?? "")}:${String(params.sourceId ?? "")}`,
        req.body as UpdateJournalClozeInput,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.get("/journal/recent-fragments", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/recent-fragments");
    if (!userId) return;
    const query = req.query as { beforeDateKey?: unknown; limit?: unknown };
    try {
      const data = await deps.journalService.listRecent(
        userId,
        String(query.beforeDateKey ?? ""),
        Number(query.limit ?? 2),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.get("/journal/tasks/:recordId/status", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/tasks/:recordId/status");
    if (!userId) return;
    try {
      const data = await deps.journalService.taskStatus(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.get("/journal/records/:recordId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/records/:recordId");
    if (!userId) return;
    try {
      const data = await deps.journalService.detail(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.delete("/journal/entries/:recordId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/entries/:recordId");
    if (!userId) return;
    try {
      await deps.journalService.delete(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
      );
      return reply.status(204).send();
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.post("/journal/entries/:recordId/image", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/entries/:recordId/image");
    if (!userId) return;
    const body = req.body as { imageUploadId?: unknown } | null;
    if (!body || typeof body.imageUploadId !== "string") {
      return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid image upload id");
    }
    try {
      const data = await deps.journalService.replaceImage(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
        body.imageUploadId,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.delete("/journal/entries/:recordId/image", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.journalEnabled) return journalDisabled(reply, requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/entries/:recordId/image");
    if (!userId) return;
    try {
      const data = await deps.journalService.replaceImage(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
        null,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });

  app.put("/journal/legacy/:assistantMessageId/hidden", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveJournalUser(req, reply, deps, requestId, "/journal/legacy/:id/hidden");
    if (!userId) return;
    try {
      await deps.journalService.hideLegacy(
        userId,
        String((req.params as { assistantMessageId?: unknown }).assistantMessageId ?? ""),
      );
      return reply.status(204).send();
    } catch (error) {
      return handleJournalError(reply, requestId, error);
    }
  });
}

async function resolveJournalUser(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: JournalRouteDeps,
  requestId: string,
  path: string,
): Promise<string | null> {
  try {
    const context = await resolveActiveUserContext({
      authorization: req.headers.authorization,
      userRepository: deps.userRepository,
    });
    return context.userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      failure(reply, 401, requestId, error.code, error.message);
      return null;
    }
    if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.journal_access_denied",
        level: "warn",
        status: "failed",
        errorCode: error.code,
        metadata: { path },
      });
      failure(reply, 403, requestId, error.code, error.message);
      return null;
    }
    throw error;
  }
}

function handleJournalError(reply: FastifyReply, requestId: string, error: unknown) {
  if (error instanceof JournalValidationError) {
    return failure(reply, 400, requestId, error.code, error.message);
  }
  if (error instanceof JournalPracticeConflictError) {
    return failure(reply, 409, requestId, error.code, "练习内容已在其他设备更新，请刷新后重试");
  }
  if (error instanceof JournalTaskInProgressError) {
    return failure(reply, 409, requestId, error.code, "上一条还在整理，请稍候");
  }
  if (error instanceof JournalNotFoundError) {
    return failure(reply, 404, requestId, error.code, "记录不存在");
  }
  if (error instanceof JournalImageNotReadyError) {
    return failure(reply, 409, requestId, error.code, "图片还没有准备好");
  }
  if (error instanceof JournalClientIdConsumedError) {
    return failure(reply, 409, requestId, error.code, "请重新发送这条记录");
  }
  if (error instanceof JournalImageModerationUnavailableError) {
    return failure(reply, 503, requestId, error.code, "图片暂时无法审核，请稍后重试");
  }
  if (error instanceof JournalImageProcessingUnavailableError) {
    return failure(reply, 503, requestId, error.code, "图片暂时无法处理，请稍后重试");
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "DAILY_QUOTA_EXCEEDED") {
      return failure(reply, 429, requestId, code, "字符额度不足");
    }
    if (code === "CONTENT_BLOCKED") {
      return failure(reply, 400, requestId, code, "这段内容暂时无法发送");
    }
  }
  throw error;
}

function failure(
  reply: FastifyReply,
  status: number,
  requestId: string,
  code: string,
  message: string,
) {
  return reply.status(status).send({
    ok: false,
    request_id: requestId,
    error: { code, message },
  });
}

function journalDisabled(reply: FastifyReply, requestId: string) {
  return failure(reply, 503, requestId, "JOURNAL_DISABLED", "生活记录功能正在准备中");
}
