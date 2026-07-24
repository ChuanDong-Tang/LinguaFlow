import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CardService } from "@lf/server/services/card/CardService.js";
import type { CardImageService } from "@lf/server/services/card/CardImageService.js";
import type { CardRelationService } from "@lf/server/services/card/CardRelationService.js";
import type { CardCollectionService } from "@lf/server/services/card/CardCollectionService.js";
import type { RecallService } from "@lf/server/services/card/RecallService.js";
import {
  CardImageModerationUnavailableError,
  CardImageProcessingUnavailableError,
  CardImageQuotaExceededError,
} from "@lf/server/services/card/CardImageService.js";
import {
  CardNotFoundError,
  CardImageNotReadyError,
  CardClientIdConsumedError,
  CardTaskInProgressError,
  CardValidationError,
  CardPracticeConflictError,
} from "@lf/server/services/card/CardService.js";
import type { CreateCardEntryInput, UpdateCardClozeInput } from "@lf/core/types/cardRecord.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import { resolveClientIp } from "../lib/rateLimit.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";

export interface CardRouteDeps {
  cardService: CardService;
  cardImageService: CardImageService;
  cardCollectionService: CardCollectionService;
  recallService: RecallService;
  cardRelationService?: CardRelationService;
  cardEnabled: boolean;
  rateLimiter?: { consume(key: string, limit: number, windowMs: number): Promise<boolean> };
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

export function registerCardRoutes(app: FastifyInstance, deps: CardRouteDeps): void {
  const rateConfig = getRuntimeConfig();

  app.post("/cards/bootstrap", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/bootstrap");
    if (!userId) return;
    const data = await deps.cardService.bootstrap(userId);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/search", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/search");
    if (!userId) return;
    const query = req.query as { q?: unknown; collectionId?: unknown; timeRange?: unknown; limit?: unknown };
    try {
      if (!await consumeLimits(deps.rateLimiter, [
        [`card:search:user:${userId}`, rateConfig.cardSearchUserRateLimit, rateConfig.cardSearchRateWindowMs],
        [`card:search:ip:${resolveClientIp(req)}`, rateConfig.cardSearchIpRateLimit, rateConfig.cardSearchRateWindowMs],
      ])) {
        return failure(reply, 429, requestId, "RATE_LIMITED", "Too many requests");
      }
      const data = await deps.recallService.lexicalSearch(userId, {
        query: typeof query.q === "string" ? query.q : undefined,
        collectionId: typeof query.collectionId === "string" ? query.collectionId : undefined,
        timeRange: typeof query.timeRange === "string" ? query.timeRange : undefined,
        limit: Number(query.limit),
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.get("/cards/recall/seed-candidates", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/seed-candidates");
    if (!userId) return;
    const query = req.query as { mode?: unknown; exclude?: unknown; limit?: unknown };
    const excluded = typeof query.exclude === "string" ? query.exclude.split(",").filter(Boolean).slice(0, 50) : [];
    try {
      if (!await consumeLimits(deps.rateLimiter, [
        [`recall:seed:user:${userId}`, rateConfig.recallSeedUserRateLimit, rateConfig.recallRateWindowMs],
      ])) {
        return failure(reply, 429, requestId, "RATE_LIMITED", "Too many requests");
      }
      const data = await deps.recallService.seedCandidates(
        userId,
        String(query.mode ?? "recommended"),
        excluded,
        Number(query.limit),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.get("/cards/recall/search", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/search");
    if (!userId) return;
    const query = req.query as { q?: unknown; collectionId?: unknown; timeRange?: unknown; limit?: unknown };
    try {
      if (!await consumeLimits(deps.rateLimiter, [
        [`recall:search:user:${userId}`, rateConfig.recallSearchUserRateLimit, rateConfig.recallRateWindowMs],
        [`recall:search:ip:${resolveClientIp(req)}`, rateConfig.recallSearchIpRateLimit, rateConfig.recallRateWindowMs],
      ])) {
        return failure(reply, 429, requestId, "RATE_LIMITED", "Too many requests");
      }
      const rawQuery = typeof query.q === "string" ? query.q : undefined;
      const semanticEnabled = rawQuery?.trim()
        ? await consumeRecallSemanticSearchAllowance(deps.rateLimiter, userId, rateConfig)
        : false;
      const data = await deps.recallService.search(userId, {
        query: rawQuery,
        collectionId: typeof query.collectionId === "string" ? query.collectionId : undefined,
        timeRange: typeof query.timeRange === "string" ? query.timeRange : undefined,
        limit: Number(query.limit),
        semanticEnabled,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.post("/cards/recall/sessions", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/sessions");
    if (!userId) return;
    const body = req.body as { seedRecordId?: unknown; launchMode?: unknown; launchContext?: unknown } | null;
    if (typeof body?.seedRecordId !== "string" || typeof body.launchMode !== "string") {
      return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid recall seed");
    }
    try {
      if (!await consumeLimits(deps.rateLimiter, [
        [`recall:create:user:${userId}`, rateConfig.recallCreateUserRateLimit, rateConfig.recallRateWindowMs],
      ])) {
        return failure(reply, 429, requestId, "RATE_LIMITED", "Too many requests");
      }
      const data = await deps.recallService.create(userId, {
        seedRecordId: body.seedRecordId,
        launchMode: body.launchMode,
        launchContext: body.launchContext,
      });
      return reply.status(201).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.get("/cards/recall/sessions/active", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/sessions/active");
    if (!userId) return;
    const data = await deps.recallService.active(userId);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/recall/sessions/:sessionId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/sessions/:sessionId");
    if (!userId) return;
    try {
      const data = await deps.recallService.get(userId, String((req.params as { sessionId: string }).sessionId));
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.post("/cards/recall/sessions/:sessionId/nodes/:nodeId/expand", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/sessions/:sessionId/nodes/:nodeId/expand");
    if (!userId) return;
    const params = req.params as { sessionId: string; nodeId: string };
    try {
      if (!await consumeLimits(deps.rateLimiter, [
        [`recall:expand:user:${userId}`, rateConfig.recallExpandUserRateLimit, rateConfig.recallRateWindowMs],
      ])) {
        return failure(reply, 429, requestId, "RATE_LIMITED", "Too many requests");
      }
      const data = await deps.recallService.expand(userId, params.sessionId, params.nodeId);
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.patch("/cards/recall/sessions/:sessionId/nodes/:nodeId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/sessions/:sessionId/nodes/:nodeId");
    if (!userId) return;
    const params = req.params as { sessionId: string; nodeId: string };
    const state = String((req.body as { state?: unknown } | null)?.state ?? "");
    try {
      const data = await deps.recallService.updateNode(userId, params.sessionId, params.nodeId, state);
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.post("/cards/recall/sessions/:sessionId/finish", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recall/sessions/:sessionId/finish");
    if (!userId) return;
    try {
      await deps.recallService.finish(userId, String((req.params as { sessionId: string }).sessionId));
      return reply.status(204).send();
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.get("/cards/collections", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/collections");
    if (!userId) return;
    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: await deps.cardCollectionService.list(userId),
    });
  });

  app.post("/cards/collections", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/collections");
    if (!userId) return;
    try {
      const data = await deps.cardCollectionService.create(userId, String((req.body as { name?: unknown } | null)?.name ?? ""));
      return reply.status(201).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.patch("/cards/collections/:collectionId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/collections/:collectionId");
    if (!userId) return;
    try {
      const data = await deps.cardCollectionService.rename(
        userId,
        String((req.params as { collectionId?: unknown }).collectionId ?? ""),
        String((req.body as { name?: unknown } | null)?.name ?? ""),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.delete("/cards/collections/:collectionId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/collections/:collectionId");
    if (!userId) return;
    try {
      await deps.cardCollectionService.remove(userId, String((req.params as { collectionId?: unknown }).collectionId ?? ""));
      return reply.status(204).send();
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.put("/cards/:recordId/collection", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/collection");
    if (!userId) return;
    const body = req.body as { collectionId?: unknown } | null;
    const collectionId = body?.collectionId === null ? null : typeof body?.collectionId === "string" ? body.collectionId : undefined;
    if (collectionId === undefined) return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid collection id");
    try {
      await deps.cardCollectionService.move(userId, [String((req.params as { recordId?: unknown }).recordId ?? "")], collectionId);
      return reply.status(204).send();
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.put("/cards/collection", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/collection");
    if (!userId) return;
    const body = req.body as { recordIds?: unknown; collectionId?: unknown } | null;
    const collectionId = body?.collectionId === null ? null : typeof body?.collectionId === "string" ? body.collectionId : undefined;
    if (!Array.isArray(body?.recordIds) || !body.recordIds.every((id) => typeof id === "string") || collectionId === undefined) {
      return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid collection move");
    }
    try {
      await deps.cardCollectionService.move(userId, body.recordIds as string[], collectionId);
      return reply.status(204).send();
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.patch("/cards/:recordId/topic", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/topic");
    if (!userId) return;
    try {
      const data = await deps.cardCollectionService.updateTopic(
        userId,
        String((req.params as { recordId?: unknown }).recordId ?? ""),
        String((req.body as { topic?: unknown } | null)?.topic ?? ""),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.post("/cards", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards");
    if (!userId) return;
    const body = req.body as Partial<CreateCardEntryInput> | null;
    if (!body || typeof body.clientId !== "string" || typeof body.originalText !== "string") {
      return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid card entry");
    }
    try {
      if (!await consumeLimits(deps.rateLimiter, [
        [`card:create:user:${userId}`, rateConfig.cardCreateUserRateLimit, rateConfig.cardCreateRateWindowMs],
        [`card:create:ip:${resolveClientIp(req)}`, rateConfig.cardCreateIpRateLimit, rateConfig.cardCreateRateWindowMs],
        ["card:create:global", rateConfig.cardCreateGlobalRateLimit, rateConfig.cardCreateRateWindowMs],
      ])) {
        return failure(reply, 429, requestId, "RATE_LIMITED", "Too many Card creation requests");
      }
      const data = await deps.cardService.create({
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
      return handleCardError(reply, requestId, error);
    }
  });

  app.post("/cards/image-uploads", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/image-uploads");
    if (!userId) return;
    if (!await consumeLimits(deps.rateLimiter, [[
      `card:image-upload:user:${userId}`,
      rateConfig.cardImageUploadUserRateLimit,
      rateConfig.cardImageUploadRateWindowMs,
    ]])) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "图片处理过于频繁，请稍后再试");
    }
    const body = req.body as { mimeType?: unknown; fileSize?: unknown; width?: unknown; height?: unknown } | null;
    try {
      const data = await deps.cardImageService.createUpload({
        userId,
        mimeType: String(body?.mimeType ?? ""),
        fileSize: Number(body?.fileSize),
        width: Number(body?.width),
        height: Number(body?.height),
      });
      return reply.status(201).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.post("/cards/image-uploads/:uploadId/complete", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/image-uploads/:uploadId/complete");
    if (!userId) return;
    try {
      const data = await deps.cardImageService.complete(userId, String((req.params as { uploadId?: unknown }).uploadId ?? ""));
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.get("/cards/image-uploads/:uploadId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/image-uploads/:uploadId");
    if (!userId) return;
    try {
      const data = await deps.cardImageService.status(userId, String((req.params as { uploadId?: unknown }).uploadId ?? ""));
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) { return handleCardError(reply, requestId, error); }
  });

  app.delete("/cards/image-uploads/:uploadId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/image-uploads/:uploadId");
    if (!userId) return;
    await deps.cardImageService.remove(userId, String((req.params as { uploadId?: unknown }).uploadId ?? ""));
    return reply.status(204).send();
  });

  app.get("/cards", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards");
    if (!userId) return;
    const query = req.query as { dateKey?: unknown; collectionId?: unknown; unclassified?: unknown; limit?: unknown };
    try {
      const data = typeof query.dateKey === "string" && query.dateKey
        ? await deps.cardService.listDate(userId, query.dateKey)
        : await deps.cardService.listLibrary(
            userId,
            query.unclassified === "true" ? null : typeof query.collectionId === "string" ? query.collectionId : undefined,
            Number(query.limit),
          );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.get("/cards/date-keys", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/date-keys");
    if (!userId) return;
    const query = req.query as { fromDateKey?: unknown; toDateKey?: unknown };
    try {
      const data = await deps.cardService.listDateKeys(
        userId,
        String(query.fromDateKey ?? ""),
        String(query.toDateKey ?? ""),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.get("/cards/practice/queue", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/practice/queue");
    if (!userId) return;
    const limit = Number((req.query as { limit?: unknown })?.limit ?? 20);
    const data = await deps.cardService.practiceQueue(userId, limit);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.put("/cards/:cardId/practice/dictation", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:cardId/practice/dictation");
    if (!userId) return;
    const params = req.params as { cardId?: unknown };
    const body = req.body as { result?: unknown } | null;
    try {
      const data = await deps.cardService.updateDictation(
        userId,
        `card:${String(params.cardId ?? "")}`,
        String(body?.result ?? "") as "correct" | "incorrect" | "revealed",
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.put("/cards/:cardId/practice/cloze", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:cardId/practice/cloze");
    if (!userId) return;
    const params = req.params as { cardId?: unknown };
    try {
      const data = await deps.cardService.updateCloze(
        userId,
        `card:${String(params.cardId ?? "")}`,
        req.body as UpdateCardClozeInput,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.get("/cards/recent-fragments", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/recent-fragments");
    if (!userId) return;
    const query = req.query as { beforeDateKey?: unknown; limit?: unknown };
    try {
      const data = await deps.cardService.listRecent(
        userId,
        String(query.beforeDateKey ?? ""),
        Number(query.limit ?? 2),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.get("/cards/:recordId/related-topics", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/related-topics");
    if (!userId) return;
    if (!await consumeRelationAllowance(deps.rateLimiter, userId, resolveClientIp(req), rateConfig)) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "Too many relation requests");
    }
    if (!deps.cardRelationService) {
      return reply.status(200).send({ ok: true, request_id: requestId, data: [] });
    }
    const { recordId } = req.params as { recordId: string };
    const rawLimit = (req.query as { limit?: unknown } | null)?.limit;
    const limit = typeof rawLimit === "string" ? Number(rawLimit) : undefined;
    const data = await deps.cardRelationService.relatedTopics(userId, recordId, limit);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/:recordId/related-phrases", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/related-phrases");
    if (!userId) return;
    if (!await consumeRelationAllowance(deps.rateLimiter, userId, resolveClientIp(req), rateConfig)) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "Too many relation requests");
    }
    if (!deps.cardRelationService) {
      return reply.status(200).send({ ok: true, request_id: requestId, data: [] });
    }
    const { recordId } = req.params as { recordId: string };
    const rawLimit = (req.query as { limit?: unknown } | null)?.limit;
    const limit = typeof rawLimit === "string" ? Number(rawLimit) : undefined;
    const data = await deps.cardRelationService.relatedPhrases(userId, recordId, limit);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/phrases/:phraseId/occurrences", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/phrases/:phraseId/occurrences");
    if (!userId) return;
    if (!await consumeRelationAllowance(deps.rateLimiter, userId, resolveClientIp(req), rateConfig)) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "Too many relation requests");
    }
    if (!deps.cardRelationService) {
      return reply.status(200).send({ ok: true, request_id: requestId, data: { items: [], nextCursor: null } });
    }
    const { phraseId } = req.params as { phraseId: string };
    const query = req.query as { cursor?: unknown; limit?: unknown };
    const data = await deps.cardRelationService.phraseOccurrences(
      userId,
      phraseId,
      typeof query.cursor === "string" ? query.cursor : undefined,
      Number(query.limit),
    );
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/:recordId/progress", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/progress");
    if (!userId) return;
    if (!await consumeRelationAllowance(deps.rateLimiter, userId, resolveClientIp(req), rateConfig)) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "Too many relation requests");
    }
    if (!deps.cardRelationService) {
      return reply.status(200).send({ ok: true, request_id: requestId, data: [] });
    }
    const { recordId } = req.params as { recordId: string };
    const rawLimit = (req.query as { limit?: unknown } | null)?.limit;
    const limit = typeof rawLimit === "string" ? Number(rawLimit) : undefined;
    const data = await deps.cardRelationService.progress(userId, recordId, limit);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/:recordId/relations", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/relations");
    if (!userId) return;
    if (!await consumeRelationAllowance(deps.rateLimiter, userId, resolveClientIp(req), rateConfig)) {
      return failure(reply, 429, requestId, "RATE_LIMITED", "Too many relation requests");
    }
    if (!deps.cardRelationService) {
      return reply.status(200).send({ ok: true, request_id: requestId, data: [] });
    }
    const { recordId } = req.params as { recordId: string };
    const rawLimit = (req.query as { limit?: unknown } | null)?.limit;
    const limit = typeof rawLimit === "string" ? Number(rawLimit) : undefined;
    const data = await deps.cardRelationService.relations(userId, recordId, limit);
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/cards/:recordId/status", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/status");
    if (!userId) return;
    try {
      const data = await deps.cardService.taskStatus(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.get("/cards/:recordId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId");
    if (!userId) return;
    try {
      const data = await deps.cardService.detail(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.delete("/cards/:recordId", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId");
    if (!userId) return;
    try {
      await deps.cardService.delete(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
      );
      return reply.status(204).send();
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.post("/cards/:recordId/image", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/image");
    if (!userId) return;
    const body = req.body as { imageUploadId?: unknown } | null;
    if (!body || typeof body.imageUploadId !== "string") {
      return failure(reply, 400, requestId, "VALIDATION_FAILED", "Invalid image upload id");
    }
    try {
      const data = await deps.cardService.replaceImage(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
        body.imageUploadId,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

  app.delete("/cards/:recordId/image", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!deps.cardEnabled) return cardDisabled(reply, requestId);
    const userId = await resolveCardUser(req, reply, deps, requestId, "/cards/:recordId/image");
    if (!userId) return;
    try {
      const data = await deps.cardService.replaceImage(
        userId,
        decodeURIComponent(String((req.params as { recordId?: unknown }).recordId ?? "")),
        null,
      );
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      return handleCardError(reply, requestId, error);
    }
  });

}

async function consumeRecallSemanticSearchAllowance(
  rateLimiter: CardRouteDeps["rateLimiter"],
  userId: string,
  config: ReturnType<typeof getRuntimeConfig>,
): Promise<boolean> {
  return consumeLimits(rateLimiter, [
    [`recall:semantic:daily:user:${userId}`, config.recallSemanticSearchDailyLimit, 86_400_000],
    ["recall:semantic:global", config.recallSemanticSearchGlobalRateLimit, config.recallRateWindowMs],
  ]);
}

async function consumeRelationAllowance(
  rateLimiter: CardRouteDeps["rateLimiter"],
  userId: string,
  ip: string,
  config: ReturnType<typeof getRuntimeConfig>,
): Promise<boolean> {
  return consumeLimits(rateLimiter, [
    [`card:relation:user:${userId}`, config.cardRelationUserRateLimit, config.cardSearchRateWindowMs],
    [`card:relation:ip:${ip}`, config.cardRelationIpRateLimit, config.cardSearchRateWindowMs],
  ]);
}

type RateLimitCheck = readonly [key: string, limit: number, windowMs: number];

export async function consumeLimits(
  rateLimiter: CardRouteDeps["rateLimiter"],
  checks: RateLimitCheck[],
): Promise<boolean> {
  if (!rateLimiter) return true;
  for (const [key, limit, windowMs] of checks) {
    if (!await rateLimiter.consume(key, limit, windowMs)) {
      const metricScope = key.split(":").slice(0, 3).join(":");
      await rateLimiter.consume(
        `metrics:card-rate-limit-rejected:${metricScope}`,
        2_000_000_000,
        86_400_000,
      ).catch(() => false);
      return false;
    }
  }
  return true;
}

async function resolveCardUser(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: CardRouteDeps,
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
        event: "auth.card_access_denied",
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

function handleCardError(reply: FastifyReply, requestId: string, error: unknown) {
  if (error instanceof CardValidationError) {
    return failure(reply, 400, requestId, error.code, error.message);
  }
  if (error instanceof CardPracticeConflictError) {
    return failure(reply, 409, requestId, error.code, "练习内容已在其他设备更新，请刷新后重试");
  }
  if (error instanceof CardTaskInProgressError) {
    return failure(reply, 409, requestId, error.code, "上一条还在整理，请稍候");
  }
  if (error instanceof CardNotFoundError) {
    return failure(reply, 404, requestId, error.code, "记录不存在");
  }
  if (error instanceof CardImageNotReadyError) {
    return failure(reply, 409, requestId, error.code, "图片还没有准备好");
  }
  if (error instanceof CardClientIdConsumedError) {
    return failure(reply, 409, requestId, error.code, "请重新发送这条记录");
  }
  if (error instanceof CardImageModerationUnavailableError) {
    return failure(reply, 503, requestId, error.code, "图片暂时无法审核，请稍后重试");
  }
  if (error instanceof CardImageProcessingUnavailableError) {
    return failure(reply, 503, requestId, error.code, "图片暂时无法处理，请稍后重试");
  }
  if (error instanceof CardImageQuotaExceededError) {
    return failure(reply, 429, requestId, error.code, "云端图片额度已用完");
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "DAILY_QUOTA_EXCEEDED") {
      return failure(reply, 429, requestId, code, "字符额度不足");
    }
    if (code === "CARD_IMAGE_QUOTA_EXCEEDED") {
      return failure(reply, 429, requestId, code, "云端图片额度已用完");
    }
    if (code === "CONTENT_BLOCKED") {
      return failure(reply, 400, requestId, code, "这段内容暂时无法发送");
    }
    if (code === "CARD_VALIDATION_FAILED" || code === "CARD_LANGUAGE_UNSUPPORTED") {
      return failure(reply, 400, requestId, code, "卡片内容或目标语言无效");
    }
    if (code.startsWith("RECALL_")) {
      const status = code.endsWith("NOT_FOUND") ? 404 : 400;
      return failure(reply, status, requestId, code, status === 404 ? "探索记录不存在" : "探索参数无效");
    }
    if (code === "CARD_SEARCH_INVALID") {
      return failure(reply, 400, requestId, code, "搜索内容无效");
    }
    if (code.startsWith("AZURE_EMBEDDING_")) {
      return failure(reply, 503, requestId, code, "语义关联服务暂时不可用");
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

function cardDisabled(reply: FastifyReply, requestId: string) {
  return failure(reply, 503, requestId, "CARD_DISABLED", "生活记录功能正在准备中");
}
