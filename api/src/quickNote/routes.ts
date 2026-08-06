import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { QuickNoteService } from "@lf/server/services/quickNote/QuickNoteService.js";
import type { CardService } from "@lf/server/services/card/CardService.js";
import { QuickNoteNotFoundError, QuickNoteValidationError } from "@lf/server/services/quickNote/QuickNoteService.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";

export function registerQuickNoteRoutes(app: FastifyInstance, deps: {
  quickNoteService: QuickNoteService;
  cardService: CardService;
  userRepository: {
    findById: (userId: string) => Promise<{ id: string; status: "active" | "disabled" | "pending_delete" } | null>;
  };
}): void {
  app.post("/quick-notes", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      const note = await deps.quickNoteService.create(userId, (req.body ?? {}) as Record<string, unknown>);
      return reply.status(201).send({ ok: true, request_id: requestId, data: serialize(note) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.get("/quick-notes", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      const rows = await deps.quickNoteService.listDay(userId, (req.query as { dateKey?: unknown }).dateKey);
      return reply.status(200).send({ ok: true, request_id: requestId, data: rows.map(serialize) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.get("/quick-notes/date-keys", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    const query = req.query as { from?: unknown; to?: unknown };
    try {
      const rows = await deps.quickNoteService.listDateKeys(userId, query.from, query.to);
      return reply.status(200).send({ ok: true, request_id: requestId, data: rows });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.post("/quick-notes/:noteId/generate", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    const target = (req.body as { target?: unknown } | null)?.target;
    try {
      const note = await deps.quickNoteService.generate(userId, (req.params as { noteId: string }).noteId, target, async (sourceText) => {
        const generated = await deps.cardService.generateDraftContent({
          userId,
          requestId,
          target: target as "expression" | "translation" | "reply",
          sourceText,
        });
        return generated.text;
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data: serialize(note) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.post("/quick-notes/:noteId/layers", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      const note = await deps.quickNoteService.addLayer(
        userId,
        (req.params as { noteId: string }).noteId,
        (req.body as { target?: unknown } | null)?.target,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data: serialize(note) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.delete("/quick-notes/:noteId/layers/:target", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      const params = req.params as { noteId: string; target: string };
      const note = await deps.quickNoteService.removeLayer(userId, params.noteId, params.target);
      return reply.status(200).send({ ok: true, request_id: requestId, data: serialize(note) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.patch("/quick-notes/:noteId/expression", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      const note = await deps.quickNoteService.updateExpression(
        userId,
        (req.params as { noteId: string }).noteId,
        (req.body as { expressionText?: unknown } | null)?.expressionText,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data: serialize(note) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.patch("/quick-notes/:noteId/content", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      const note = await deps.quickNoteService.updateContent(
        userId,
        (req.params as { noteId: string }).noteId,
        (req.body ?? {}) as Record<string, unknown>,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data: serialize(note) });
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });

  app.delete("/quick-notes/:noteId", async (req, reply) => {
    const requestId = prepareReply(req, reply);
    const userId = await resolveUser(req, reply, deps, requestId);
    if (!userId) return;
    try {
      await deps.quickNoteService.remove(userId, (req.params as { noteId: string }).noteId);
      return reply.status(204).send();
    } catch (error) {
      return handleError(reply, requestId, error);
    }
  });
}

function prepareReply(req: FastifyRequest, reply: FastifyReply): string {
  const requestId = resolveRequestId(req.headers["x-request-id"]);
  reply.header("x-request-id", requestId);
  return requestId;
}

async function resolveUser(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: Parameters<typeof registerQuickNoteRoutes>[1],
  requestId: string,
): Promise<string | null> {
  try {
    return (await resolveActiveUserContext({
      authorization: req.headers.authorization,
      userRepository: deps.userRepository,
    })).userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) failure(reply, 401, requestId, error.code, error.message);
    else if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
      failure(reply, 403, requestId, error.code, error.message);
    } else throw error;
    return null;
  }
}

function handleError(reply: FastifyReply, requestId: string, error: unknown) {
  if (error instanceof QuickNoteValidationError) return failure(reply, 400, requestId, error.code, error.message);
  if (error instanceof QuickNoteNotFoundError) return failure(reply, 404, requestId, error.code, "随手记不存在");
  throw error;
}

function serialize(note: {
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}) {
  return {
    source: "source" in note ? note.source : "quick_note",
    readOnly: "readOnly" in note ? note.readOnly : false,
    ...note,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function failure(reply: FastifyReply, status: number, requestId: string, code: string, message: string) {
  return reply.status(status).send({ ok: false, request_id: requestId, error: { code, message } });
}
