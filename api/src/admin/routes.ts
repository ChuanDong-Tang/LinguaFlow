import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { SubscriptionService } from "@lf/server/services/subscription/SubscriptionService.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import { dateKeyRangeInBusinessTimeZone, formatDateKeyInTimeZone } from "@lf/server/services/time/businessClock.js";
import { requireAdmin } from "../auth/adminAuth.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";

export interface AdminRouteDeps {
  subscriptionService: SubscriptionService;
  prisma: {
    user: {
      findMany: (args: any) => Promise<any[]>;
      findUnique: (args: any) => Promise<any | null>;
    };
    paymentOrder: {
      findMany: (args: any) => Promise<any[]>;
      findUnique: (args: any) => Promise<any | null>;
      update: (args: any) => Promise<any>;
      count: (args: any) => Promise<number>;
    };
    subscription: {
      findMany: (args: any) => Promise<any[]>;
      findFirst: (args: any) => Promise<any | null>;
      findUnique: (args: any) => Promise<any | null>;
      update: (args: any) => Promise<any>;
    };
    paymentEvent: {
      count: (args: any) => Promise<number>;
      findMany: (args: any) => Promise<any[]>;
    };
    aiRequestLog: {
      count: (args: any) => Promise<number>;
      findMany: (args: any) => Promise<any[]>;
    };
    ttsAsset: {
      count: (args: any) => Promise<number>;
      findMany: (args: any) => Promise<any[]>;
    };
    ttsRequestLog: {
      findMany: (args: any) => Promise<any[]>;
    };
    sttRequestLog: {
      findMany: (args: any) => Promise<any[]>;
    };
    adminAuditLog: {
      create: (args: any) => Promise<any>;
    };
    $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
    $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
    $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<any[]>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  app.get("/admin/users", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const q = String((req.query as Record<string, unknown>)?.q ?? "").trim();

    const users = await deps.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { nickname: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: users });
  });

  app.get("/admin/orders", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const status = typeof query.status === "string" ? query.status.trim() : "";
    const userId = typeof query.userId === "string" ? query.userId.trim() : "";

    const orders = await deps.prisma.paymentOrder.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(userId ? { userId } : {}),
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: orders });
  });

  app.get("/admin/users/:id/overview", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const id = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    if (!id) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "user id is required" },
      });
    }

    const [user, orders, subscriptions] = await Promise.all([
      deps.prisma.user.findUnique({ where: { id } }),
      deps.prisma.paymentOrder.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
      deps.prisma.subscription.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

    if (!user) {
      return reply.status(404).send({
        ok: false,
        request_id: requestId,
        error: { code: "RESOURCE_NOT_FOUND", message: "User not found" },
      });
    }

    const data = { user, orders, subscriptions };
    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/admin/users/:id/diagnostics", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const id = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    if (!id) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "user id is required" },
      });
    }

    const [
      user,
      orders,
      subscriptions,
      entitlements,
      autoRenewSubscriptions,
      appleIapAccountLinks,
      systemEventLogs,
      adminAuditLogs,
    ] = await Promise.all([
      deps.prisma.user.findUnique({ where: { id } }),
      deps.prisma.paymentOrder.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
      deps.prisma.subscription.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
      deps.prisma.$queryRawUnsafe(
        `SELECT *
         FROM "entitlements"
         WHERE "userId" = $1
         ORDER BY "dateKey" DESC
         LIMIT 60`,
        id
      ),
      deps.prisma.$queryRawUnsafe(
        `SELECT *
         FROM "auto_renew_subscriptions"
         WHERE "userId" = $1
         ORDER BY "updatedAt" DESC
         LIMIT 50`,
        id
      ),
      deps.prisma.$queryRawUnsafe(
        `SELECT *
         FROM "apple_iap_account_links"
         WHERE "userId" = $1
         ORDER BY "updatedAt" DESC
         LIMIT 50`,
        id
      ),
      deps.prisma.$queryRawUnsafe(
        `SELECT "id","module","event","level","status","errorCode","errorMessage","userId","requestId","metadata","createdAt"
         FROM "system_event_logs"
         WHERE "userId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 100`,
        id
      ),
      deps.prisma.$queryRawUnsafe(
        `SELECT *
         FROM "admin_audit_logs"
         WHERE "targetType" = 'user'
           AND "targetId" = $1
         ORDER BY "createdAt" DESC
         LIMIT 100`,
        id
      ),
    ]);

    if (!user) {
      return reply.status(404).send({
        ok: false,
        request_id: requestId,
        error: { code: "RESOURCE_NOT_FOUND", message: "User not found" },
      });
    }

    const now = new Date();
    const currentSubscription =
      subscriptions.find((item) => item.status === "active" && item.expiresAt > now) ?? null;
    const currentAutoRenew =
      (autoRenewSubscriptions as any[]).find((item) =>
        ["pending", "active", "billing_retry"].includes(String(item.status))
      ) ?? null;
    const paymentEventProviderOrderIds = uniqueNonEmptyStrings([
      ...orders.map((item) => item.providerOrderId),
      ...subscriptions.map((item) => item.sourceOrderId),
      ...(autoRenewSubscriptions as any[]).flatMap((item) => [
        item.providerAgreementId,
        item.latestTransactionId,
        item.sourceOrderId,
      ]),
      ...(appleIapAccountLinks as any[]).flatMap((item) => [
        item.originalTransactionId,
        item.latestTransactionId,
      ]),
    ]);
    const paymentEvents = paymentEventProviderOrderIds.length
      ? await deps.prisma.paymentEvent.findMany({
          where: { providerOrderId: { in: paymentEventProviderOrderIds } },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [];

    const data = {
      user,
      currentSubscription,
      currentAutoRenew,
      orders,
      subscriptions,
      entitlements,
      autoRenewSubscriptions,
      appleIapAccountLinks,
      paymentEvents,
      systemEventLogs,
      adminAuditLogs,
    };

    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/admin/subscriptions", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const userId = typeof query.userId === "string" ? query.userId.trim() : "";
    const status = typeof query.status === "string" ? query.status.trim() : "";

    const subscriptions = await deps.prisma.subscription.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(status ? { status } : {}),
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: subscriptions });
  });

  app.get("/admin/metrics/overview", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const now = new Date();
    const query = req.query as Record<string, unknown>;
    const runtimeConfig = getRuntimeConfig();
    const clock = {
      serverNowIso: now.toISOString(),
      businessTimeZone: runtimeConfig.quotaTimeZone,
      businessDateKey: formatDateKeyInTimeZone(now),
    };
    const requestedToDate = readDateKeyQuery(query.toDate);
    const requestedFromDate = readDateKeyQuery(query.fromDate);
    const toDate = requestedToDate ?? clock.businessDateKey;
    const fromDate = clampFromDateKey(requestedFromDate ?? addDateKeyDays(toDate, -13), toDate, 90);

    const [summaryRows, recentUsage, dailyUserActivity, dailyTtsUsage, autoRenewSummary] = await Promise.all([
      deps.prisma.$queryRawUnsafe(
        `WITH active_users AS (
           SELECT id FROM "users" WHERE status = 'active'
         ),
         active_memberships AS (
           SELECT DISTINCT "userId", plan
           FROM "subscriptions"
           WHERE status = 'active'
             AND "expiresAt" > now()
         ),
         today_entitlements AS (
           SELECT "userId","dateKey","dailyTotalLimit","usedTotalChars"
           FROM "entitlements"
           WHERE "dateKey" = $1
              OR (
                "dateKey" = 'free_trial'
                AND "usedTotalChars" > 0
                AND "updatedAt" >= (($1::date)::timestamp AT TIME ZONE $2)
                AND "updatedAt" < (($1::date + 1)::timestamp AT TIME ZONE $2)
              )
         )
         SELECT
           (SELECT COUNT(*)::int FROM active_users) AS "totalUsers",
           (SELECT COUNT(DISTINCT u.id)::int FROM active_users u JOIN active_memberships am ON am."userId" = u.id) AS "memberUsers",
           (SELECT COUNT(DISTINCT u.id)::int FROM active_users u JOIN active_memberships am ON am."userId" = u.id WHERE am.plan = 'plus_monthly') AS "plusUsers",
           (SELECT COUNT(DISTINCT u.id)::int FROM active_users u JOIN active_memberships am ON am."userId" = u.id WHERE am.plan = 'pro_monthly') AS "proUsers",
           (SELECT COUNT(*)::int FROM active_users u LEFT JOIN active_memberships am ON am."userId" = u.id WHERE am."userId" IS NULL) AS "nonMemberUsers",
           (SELECT COUNT(DISTINCT "userId")::int FROM today_entitlements) AS "todayQuotaUsers",
           COALESCE((SELECT ROUND(AVG("usedTotalChars")::numeric, 2)::float8 FROM today_entitlements), 0) AS "todayAvgUsedChars",
           COALESCE((SELECT SUM("usedTotalChars")::int FROM today_entitlements), 0) AS "todayTotalUsedChars",
           (SELECT COUNT(*)::int FROM today_entitlements WHERE "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit") AS "todayQuotaFullUsers",
           (SELECT COUNT(*)::int FROM today_entitlements WHERE "dateKey" <> 'free_trial' AND "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit") AS "todayProQuotaFullUsers",
           (SELECT COUNT(*)::int FROM today_entitlements WHERE "dateKey" = 'free_trial' AND "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit") AS "todayFreeQuotaFullUsers"`,
        clock.businessDateKey,
        clock.businessTimeZone
      ),
      deps.prisma.$queryRawUnsafe(
        `WITH usage_rows AS (
           SELECT
             CASE
               WHEN "dateKey" = 'free_trial' AND "usedTotalChars" > 0 THEN to_char("updatedAt" AT TIME ZONE $3, 'YYYY-MM-DD')
               ELSE "dateKey"
             END AS "dateKey",
             "userId",
             "dateKey" = 'free_trial' AS "isFreeTrial",
             "dailyTotalLimit",
             "usedTotalChars"
           FROM "entitlements"
         )
         SELECT
           "dateKey",
           COUNT(DISTINCT "userId")::int AS "users",
           ROUND(AVG("usedTotalChars")::numeric, 2)::float8 AS "avgUsedChars",
           SUM("usedTotalChars")::int AS "totalUsedChars",
           COUNT(*) FILTER (WHERE "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit")::int AS "quotaFullUsers",
           COUNT(*) FILTER (WHERE NOT "isFreeTrial" AND "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit")::int AS "proQuotaFullUsers",
           COUNT(*) FILTER (WHERE "isFreeTrial" AND "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit")::int AS "freeQuotaFullUsers"
         FROM usage_rows
         WHERE "dateKey" >= $1
           AND "dateKey" <= $2
         GROUP BY "dateKey"
         ORDER BY "dateKey" DESC`,
        fromDate,
        toDate,
        clock.businessTimeZone
      ),
      deps.prisma.$queryRawUnsafe(
        `WITH days AS (
           SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
         ),
         message_days AS (
           SELECT
             COALESCE("conversationDateKey", to_char("createdAt" AT TIME ZONE $3, 'YYYY-MM-DD')) AS "dateKey",
             "userId",
             role,
             status,
             "inputChars",
             "outputChars"
           FROM "messages"
           WHERE "createdAt" >= (($1::date)::timestamp AT TIME ZONE $3)
             AND "createdAt" < (($2::date + 1)::timestamp AT TIME ZONE $3)
         ),
         quota_days AS (
           SELECT DISTINCT
             to_char("updatedAt" AT TIME ZONE $3, 'YYYY-MM-DD') AS "dateKey",
             "userId"
           FROM "entitlements"
           WHERE "dateKey" = 'free_trial'
             AND "usedTotalChars" > 0
             AND "updatedAt" >= (($1::date)::timestamp AT TIME ZONE $3)
             AND "updatedAt" < (($2::date + 1)::timestamp AT TIME ZONE $3)
         )
         SELECT
           to_char(d.day, 'YYYY-MM-DD') AS "dateKey",
           (
             SELECT COUNT(*)::int
             FROM "users" u
             WHERE u.status = 'active'
               AND u."createdAt" < ((d.day + 1)::timestamp AT TIME ZONE $3)
           ) AS "totalUsers",
          (
            SELECT COUNT(DISTINCT users."userId")::int
            FROM (
              SELECT md."userId"
              FROM message_days md
              WHERE md."dateKey" = to_char(d.day, 'YYYY-MM-DD')
                AND md.role = 'user'
              UNION
              SELECT qd."userId"
              FROM quota_days qd
              WHERE qd."dateKey" = to_char(d.day, 'YYYY-MM-DD')
            ) users
          ) AS "usingUsers",
          (
            SELECT COUNT(DISTINCT users."userId")::int
            FROM (
              SELECT md."userId"
              FROM message_days md
              WHERE md."dateKey" = to_char(d.day, 'YYYY-MM-DD')
                AND md.role = 'user'
                AND md.status = 'success'
              UNION
              SELECT qd."userId"
              FROM quota_days qd
              WHERE qd."dateKey" = to_char(d.day, 'YYYY-MM-DD')
            ) users
          ) AS "activeUsers",
           (
             SELECT COUNT(DISTINCT s."userId")::int
             FROM "subscriptions" s
             JOIN "users" u ON u.id = s."userId" AND u.status = 'active'
             WHERE s.status = 'active'
               AND s.plan IN ('plus_monthly', 'pro_monthly')
               AND s."startedAt" < ((d.day + 1)::timestamp AT TIME ZONE $3)
               AND s."expiresAt" > (d.day::timestamp AT TIME ZONE $3)
           ) AS "memberUsers",
           (
             SELECT COUNT(DISTINCT s."userId")::int
             FROM "subscriptions" s
             JOIN "users" u ON u.id = s."userId" AND u.status = 'active'
             WHERE s.status = 'active'
               AND s.plan = 'plus_monthly'
               AND s."startedAt" < ((d.day + 1)::timestamp AT TIME ZONE $3)
               AND s."expiresAt" > (d.day::timestamp AT TIME ZONE $3)
           ) AS "plusUsers",
           (
             SELECT COUNT(DISTINCT s."userId")::int
             FROM "subscriptions" s
             JOIN "users" u ON u.id = s."userId" AND u.status = 'active'
             WHERE s.status = 'active'
               AND s.plan = 'pro_monthly'
               AND s."startedAt" < ((d.day + 1)::timestamp AT TIME ZONE $3)
               AND s."expiresAt" > (d.day::timestamp AT TIME ZONE $3)
           ) AS "proUsers",
           COALESCE((
             SELECT SUM(md."inputChars" + md."outputChars")::int
             FROM message_days md
             WHERE md."dateKey" = to_char(d.day, 'YYYY-MM-DD')
           ), 0) AS "totalMessageChars",
           COALESCE((
             SELECT ROUND(
               SUM(md."inputChars" + md."outputChars")::numeric /
               NULLIF(COUNT(DISTINCT md."userId"), 0),
               2
             )::float8
             FROM message_days md
             WHERE md."dateKey" = to_char(d.day, 'YYYY-MM-DD')
           ), 0) AS "avgMessageCharsPerUsingUser"
         FROM days d
         ORDER BY d.day DESC`,
        fromDate,
        toDate,
        clock.businessTimeZone
      ),
      deps.prisma.$queryRawUnsafe(
        `WITH days AS (
           SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
         ),
         tts_days AS (
           SELECT
             to_char("createdAt" AT TIME ZONE $3, 'YYYY-MM-DD') AS "dateKey",
             status,
             "sourceTextChars",
             "cacheHit",
             "deduped"
           FROM "tts_request_logs"
           WHERE "createdAt" >= (($1::date)::timestamp AT TIME ZONE $3)
             AND "createdAt" < (($2::date + 1)::timestamp AT TIME ZONE $3)
         )
         SELECT
           to_char(d.day, 'YYYY-MM-DD') AS "dateKey",
           COALESCE(COUNT(t."dateKey"), 0)::int AS "totalRequests",
           COALESCE(COUNT(*) FILTER (WHERE t.status = 'success'), 0)::int AS "successRequests",
           COALESCE(COUNT(*) FILTER (WHERE t.status = 'failed'), 0)::int AS "failedRequests",
           COALESCE(COUNT(*) FILTER (WHERE t."cacheHit" = true), 0)::int AS "cacheHitRequests",
           COALESCE(COUNT(*) FILTER (WHERE t."deduped" = true), 0)::int AS "dedupedRequests",
           COALESCE(COUNT(*) FILTER (
             WHERE t.status = 'success'
               AND t."cacheHit" = false
               AND t."deduped" = false
           ), 0)::int AS "generatedRequests",
           COALESCE(SUM(t."sourceTextChars") FILTER (
             WHERE t.status = 'success'
               AND t."cacheHit" = false
               AND t."deduped" = false
           ), 0)::int AS "generatedChars"
         FROM days d
         LEFT JOIN tts_days t ON t."dateKey" = to_char(d.day, 'YYYY-MM-DD')
         GROUP BY d.day
         ORDER BY d.day DESC`,
        fromDate,
        toDate,
        clock.businessTimeZone
      ),
      deps.prisma.$queryRawUnsafe(
        `SELECT provider, status, COUNT(*)::int AS count
         FROM "auto_renew_subscriptions"
         GROUP BY provider, status
         ORDER BY provider, status`
      ),
    ]);

    const ttsUsageRows = Array.isArray(dailyTtsUsage) ? dailyTtsUsage as any[] : [];
    const ttsCost = buildTtsCostSummary({
      rows: ttsUsageRows,
      costPerMillionCharsCents: runtimeConfig.ttsCostPerMillionCharsCents,
      currency: runtimeConfig.ttsCostCurrency,
    });

    const data = {
      clock,
      range: { fromDate, toDate },
      summary: (summaryRows as any[])[0] ?? {},
      recentUsage,
      dailyUserActivity,
      dailyTtsUsage: ttsUsageRows.map((row) => ({
        ...row,
        estimatedCostCents: estimateCostCents(row.generatedChars, runtimeConfig.ttsCostPerMillionCharsCents),
        estimatedCost: formatMinorCurrency(
          estimateCostCents(row.generatedChars, runtimeConfig.ttsCostPerMillionCharsCents),
          runtimeConfig.ttsCostCurrency
        ),
      })),
      ttsCost,
      autoRenewSummary,
    };

    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.post("/admin/orders/:id/manual-refund", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const id = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();
    const refundReference = String(body.refundReference ?? "").trim();

    if (!id || !reason) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "id and reason are required" },
      });
    }

    try {
      const result = await deps.prisma.$transaction(async (tx) => {
        const beforeOrder = await tx.paymentOrder.findUnique({ where: { id } });
        if (!beforeOrder) {
          throw new AdminBusinessError(404, "RESOURCE_NOT_FOUND", "Order not found");
        }
        if (beforeOrder.status !== "paid") {
          throw new AdminBusinessError(
            409,
            "ORDER_STATUS_CONFLICT",
            "Only paid orders can be manually refunded"
          );
        }

        const now = new Date();
        const effectiveAt = getNextDayStartInBusinessTimeZone(now);
        const businessTimeZone = getRuntimeConfig().quotaTimeZone;
        const nextMetadata = {
          ...(beforeOrder.metadata && typeof beforeOrder.metadata === "object"
            ? (beforeOrder.metadata as Record<string, unknown>)
            : {}),
          manualRefund: {
            reason,
            refundReference: refundReference || null,
            adminId: admin.adminId,
            at: now.toISOString(),
            entitlementEffectiveAt: effectiveAt.toISOString(),
            entitlementPolicy: `next_day_00:00_${businessTimeZone}`,
          },
        };

        const afterOrder = await tx.paymentOrder.update({
          where: { id },
          data: {
            status: "refunded",
            metadata: nextMetadata,
          },
        });

        const activeSubscription = await tx.subscription.findFirst({
          where: {
            userId: beforeOrder.userId,
            status: "active",
          },
          orderBy: { expiresAt: "desc" },
        });

        let beforeSubscription = null;
        let afterSubscription = null;
        if (activeSubscription) {
          beforeSubscription = activeSubscription;
          afterSubscription = await tx.subscription.update({
            where: { id: activeSubscription.id },
            data: {
              status: "cancelled",
              expiresAt: effectiveAt,
            },
          });
        }

        return {
          beforeOrder,
          afterOrder,
          beforeSubscription,
          afterSubscription,
        };
      });

      await writeAuditLog(deps, {
        adminId: admin.adminId,
        action: "admin.orders.manual_refund",
        targetType: "payment_order",
        targetId: id,
        requestId,
        ip: req.ip,
        reason,
        beforeData: {
          order: { status: result.beforeOrder.status, metadata: result.beforeOrder.metadata },
          subscription: result.beforeSubscription
            ? { id: result.beforeSubscription.id, status: result.beforeSubscription.status }
            : null,
        },
        afterData: {
          order: { status: result.afterOrder.status, metadata: result.afterOrder.metadata },
          subscription: result.afterSubscription
            ? {
                id: result.afterSubscription.id,
                status: result.afterSubscription.status,
                expiresAt: result.afterSubscription.expiresAt,
              }
            : null,
        },
      });

      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          order: result.afterOrder,
          subscription: result.afterSubscription,
        },
      });
    } catch (error) {
      if (error instanceof AdminBusinessError) {
        return reply.status(error.status).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  });

  app.post("/admin/orders/:id/manual-close", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const id = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    const reason = String((req.body as Record<string, unknown>)?.reason ?? "").trim();

    if (!id || !reason) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "id and reason are required" },
      });
    }

    const before = await deps.prisma.paymentOrder.findUnique({ where: { id } });
    if (!before) {
      return reply.status(404).send({
        ok: false,
        request_id: requestId,
        error: { code: "RESOURCE_NOT_FOUND", message: "Order not found" },
      });
    }

    if (before.status !== "pending") {
      return reply.status(409).send({
        ok: false,
        request_id: requestId,
        error: { code: "ORDER_STATUS_CONFLICT", message: "Only pending orders can be manually closed" },
      });
    }

    const nextMetadata = {
      ...(before.metadata && typeof before.metadata === "object" ? (before.metadata as Record<string, unknown>) : {}),
      manualClose: {
        reason,
        adminId: admin.adminId,
        at: new Date().toISOString(),
      },
    };

    const updated = await deps.prisma.paymentOrder.update({
      where: { id },
      data: {
        status: "closed",
        metadata: nextMetadata,
      },
    });

    await writeAuditLog(deps, {
      adminId: admin.adminId,
      action: "admin.orders.manual_close",
      targetType: "payment_order",
      targetId: id,
      requestId,
      ip: req.ip,
      reason,
      beforeData: { status: before.status, metadata: before.metadata },
      afterData: { status: updated.status, metadata: updated.metadata },
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: updated });
  });

  app.post("/admin/subscriptions/:id/manual-adjust", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const id = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status.trim() : "";
    const expiresAtRaw = typeof body.expiresAt === "string" ? body.expiresAt.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const allowedStatus = new Set(["active", "expired", "cancelled"]);

    if (!id || !status || !expiresAtRaw || !reason) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "id, status, expiresAt, reason are required" },
      });
    }
    if (!allowedStatus.has(status)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "Invalid status" },
      });
    }

    const expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "Invalid expiresAt" },
      });
    }

    const before = await deps.prisma.subscription.findUnique({ where: { id } });
    if (!before) {
      return reply.status(404).send({
        ok: false,
        request_id: requestId,
        error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found" },
      });
    }

    const updated = await deps.prisma.subscription.update({
      where: { id },
      data: {
        status,
        expiresAt,
      },
    });

    await writeAuditLog(deps, {
      adminId: admin.adminId,
      action: "admin.subscriptions.manual_adjust",
      targetType: "subscription",
      targetId: id,
      requestId,
      ip: req.ip,
      reason,
      beforeData: before,
      afterData: updated,
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: updated });
  });

  app.post("/admin/users/:id/grant-pro-monthly", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const userId = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();
    const monthsRaw = Number(body.months ?? 1);
    const months = Number.isFinite(monthsRaw) ? Math.trunc(monthsRaw) : 1;

    if (!userId || !reason) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "user id and reason are required" },
      });
    }

    if (months < 1 || months > 12) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "months must be between 1 and 12" },
      });
    }

    const user = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user) {
      return reply.status(404).send({
        ok: false,
        request_id: requestId,
        error: { code: "RESOURCE_NOT_FOUND", message: "User not found" },
      });
    }
    if (user.status !== "active") {
      return reply.status(409).send({
        ok: false,
        request_id: requestId,
        error: { code: "ACCOUNT_DISABLED", message: "User is not active" },
      });
    }

    const sourceOrderId = `admin_grant:${userId}:${Date.now()}:${randomUUID()}`;
    const result = await deps.subscriptionService.openOrRenewMembership({
      userId,
      plan: "pro_monthly",
      sourceOrderId,
      months,
    });

    await writeAuditLog(deps, {
      adminId: admin.adminId,
      action: "admin.users.grant_pro_monthly",
      targetType: "user",
      targetId: userId,
      requestId,
      ip: req.ip,
      reason,
      afterData: {
        months,
        sourceOrderId,
        subscriptionId: result.subscription.id,
        expiresAt: result.subscription.expiresAt,
      },
    });

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        userId,
        months,
        sourceOrderId,
        subscription: result.subscription,
      },
    });
  });

  app.post("/admin/users/:id/cancel-pro-next-day", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const userId = String((req.params as Record<string, unknown>)?.id ?? "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();

    if (!userId || !reason) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "REQUEST_INVALID", message: "user id and reason are required" },
      });
    }

    const user = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user) {
      return reply.status(404).send({
        ok: false,
        request_id: requestId,
        error: { code: "RESOURCE_NOT_FOUND", message: "User not found" },
      });
    }

    const now = new Date();
    const effectiveAt = getNextDayStartInBusinessTimeZone(now);
    const before = await deps.prisma.subscription.findFirst({
      where: {
        userId,
        status: "active",
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: "desc" },
    });
    if (!before) {
      return reply.status(409).send({
        ok: false,
        request_id: requestId,
        error: { code: "NO_ACTIVE_PRO", message: "User has no active Pro subscription" },
      });
    }

    const updated = await deps.prisma.subscription.update({
      where: { id: before.id },
      data: {
        status: "active",
        expiresAt: effectiveAt,
      },
    });

    await writeAuditLog(deps, {
      adminId: admin.adminId,
      action: "admin.users.cancel_pro_next_day",
      targetType: "user",
      targetId: userId,
      requestId,
      ip: req.ip,
      reason,
      beforeData: {
        subscriptionId: before.id,
        status: before.status,
        expiresAt: before.expiresAt,
      },
      afterData: {
        subscriptionId: updated.id,
        status: updated.status,
        expiresAt: updated.expiresAt,
        effectivePolicy: `next_day_00:00_${getRuntimeConfig().quotaTimeZone}`,
      },
    });

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        userId,
        subscription: updated,
        effectiveAt,
        businessTimeZone: getRuntimeConfig().quotaTimeZone,
      },
    });
  });

  app.get("/admin/audit-logs", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const targetType = typeof query.targetType === "string" ? query.targetType.trim() : "";
    const targetId = typeof query.targetId === "string" ? query.targetId.trim() : "";
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));

    const rows = await deps.prisma.$queryRawUnsafe(
      `SELECT * FROM "admin_audit_logs"
       WHERE ($1::text IS NULL OR "targetType" = $1)
         AND ($2::text IS NULL OR "targetId" = $2)
       ORDER BY "createdAt" DESC
       LIMIT $3`,
      targetType || null,
      targetId || null,
      limit
    );

    return reply.status(200).send({ ok: true, request_id: requestId, data: rows });
  });

  app.get("/admin/ops/alerts", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const pendingCutoff = new Date(now.getTime() - 15 * 60 * 1000);

    const [paymentNotifyFailed24h, pendingBacklog, aiFailed24h, quotaExceeded24h, ttsFailed24h, durations] = await Promise.all([
      deps.prisma.paymentEvent.count({ where: { status: "failed", createdAt: { gte: last24h } } }),
      deps.prisma.paymentOrder.count({ where: { status: "pending", createdAt: { lt: pendingCutoff } } }),
      deps.prisma.aiRequestLog.count({
        where: {
          status: { in: ["failed", "cancelled"] },
          createdAt: { gte: last24h },
        },
      }),
      deps.prisma.aiRequestLog.count({ where: { status: "quota_exceeded", createdAt: { gte: last24h } } }),
      deps.prisma.ttsAsset.count({ where: { status: "failed", updatedAt: { gte: last24h } } }),
      deps.prisma.aiRequestLog.findMany({
        where: { createdAt: { gte: last24h }, durationMs: { not: null } },
        select: { durationMs: true },
        take: 5000,
      }),
    ]);

    const p95Ms = computeP95(durations.map((x) => Number(x.durationMs)).filter((n) => Number.isFinite(n)));

    const data = {
      window: { from: last24h.toISOString(), to: now.toISOString() },
      paymentNotifyFailed24h,
      pendingBacklog,
      aiFailed24h,
      quotaExceeded24h,
      ttsFailed24h,
      apiP95Ms: p95Ms,
      thresholds: {
        paymentNotifyFailed24h: 0,
        pendingBacklog: 10,
        aiFailed24h: 20,
        quotaExceeded24h: 50,
        ttsFailed24h: 10,
        apiP95Ms: 3000,
      },
    };

    return reply.status(200).send({ ok: true, request_id: requestId, data });
  });

  app.get("/admin/system-event-logs", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const module = typeof query.module === "string" ? query.module.trim() : "";
    const event = typeof query.event === "string" ? query.event.trim() : "";
    const statusRaw = typeof query.status === "string" ? query.status.trim() : "failed";
    const levelRaw = typeof query.level === "string" ? query.level.trim() : "";
    const cursorCreatedAtRaw = typeof query.cursorCreatedAt === "string" ? query.cursorCreatedAt.trim() : "";
    const cursorId = typeof query.cursorId === "string" ? query.cursorId.trim() : "";
    const allowedStatuses = new Set(["success", "failed", "ignored"]);
    const allowedLevels = new Set(["info", "warn", "error"]);
    const status = statusRaw && allowedStatuses.has(statusRaw) ? statusRaw : "";
    const level = levelRaw && allowedLevels.has(levelRaw) ? levelRaw : "";
    const requestedLimit = Number(query.limit ?? 50);
    const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 50));
    const cursorCreatedAt = cursorCreatedAtRaw ? new Date(cursorCreatedAtRaw) : null;
    const hasCursor = Boolean(cursorId && cursorCreatedAt && !Number.isNaN(cursorCreatedAt.getTime()));

    const rows = await deps.prisma.$queryRawUnsafe(
      `SELECT "id","module","event","level","status","errorCode","errorMessage","userId","requestId","metadata","createdAt"
       FROM "system_event_logs"
       WHERE ($1::text IS NULL OR "module" = $1)
         AND ($2::text IS NULL OR "event" = $2)
         AND ($3::text IS NULL OR "status" = $3::"SystemEventLogStatus")
         AND ($4::text IS NULL OR "level" = $4::"SystemEventLogLevel")
         AND ($5::timestamptz IS NULL OR ("createdAt", "id") < ($5::timestamptz, $6::text))
       ORDER BY "createdAt" DESC, "id" DESC
       LIMIT $7`,
      module || null,
      event || null,
      status || null,
      level || null,
      hasCursor ? cursorCreatedAt : null,
      hasCursor ? cursorId : null,
      limit + 1
    ) as Array<{
      id: string;
      module: string;
      event: string;
      level: string;
      status: string;
      errorCode: string | null;
      errorMessage: string | null;
      userId: string | null;
      requestId: string | null;
      metadata: unknown;
      createdAt: Date;
    }>;
    const pageRows = rows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    const hasNext = rows.length > limit;
    const nextCursor = hasNext && last
      ? { createdAt: last.createdAt.toISOString(), id: last.id }
      : null;

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: pageRows,
      pagination: { limit, hasNext, nextCursor },
    });
  });

  app.get("/admin/tts/assets", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const userId = typeof query.userId === "string" ? query.userId.trim() : "";
    const messageId = typeof query.messageId === "string" ? query.messageId.trim() : "";
    const status = typeof query.status === "string" ? query.status.trim() : "";
    const languageCode = typeof query.languageCode === "string" ? query.languageCode.trim() : "";
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));

    const rows = await deps.prisma.ttsAsset.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(messageId ? { messageId } : {}),
        ...(status ? { status } : {}),
        ...(languageCode ? { languageCode } : {}),
      },
      select: {
        id: true,
        userId: true,
        messageId: true,
        provider: true,
        voiceCode: true,
        languageCode: true,
        sourceTextHash: true,
        format: true,
        status: true,
        objectKey: true,
        durationMs: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: rows });
  });

  app.get("/admin/tts/request-logs", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const userId = typeof query.userId === "string" ? query.userId.trim() : "";
    const status = typeof query.status === "string" ? query.status.trim() : "";
    const cacheHit = typeof query.cacheHit === "string" ? query.cacheHit.trim() : "";
    const deduped = typeof query.deduped === "string" ? query.deduped.trim() : "";
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));

    const rows = await deps.prisma.ttsRequestLog.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(status ? { status } : {}),
        ...(cacheHit === "true" ? { cacheHit: true } : {}),
        ...(cacheHit === "false" ? { cacheHit: false } : {}),
        ...(deduped === "true" ? { deduped: true } : {}),
        ...(deduped === "false" ? { deduped: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: rows });
  });

  app.get("/admin/stt/request-logs", async (req, reply) => {
    const admin = await requireAdmin(req, reply, deps.prisma.user, deps.systemEventLogRepository);
    if (!admin) return;

    const requestId = resolveRequestId(req.headers["x-request-id"]);
    const query = req.query as Record<string, unknown>;
    const userId = typeof query.userId === "string" ? query.userId.trim() : "";
    const status = typeof query.status === "string" ? query.status.trim() : "";
    const provider = typeof query.provider === "string" ? query.provider.trim() : "";
    const languageIdMode = typeof query.languageIdMode === "string" ? query.languageIdMode.trim() : "";
    const recognizedTextPresent = typeof query.recognizedTextPresent === "string"
      ? query.recognizedTextPresent.trim()
      : "";
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));

    const rows = await deps.prisma.sttRequestLog.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(status ? { status } : {}),
        ...(provider ? { provider } : {}),
        ...(languageIdMode ? { languageIdMode } : {}),
        ...(recognizedTextPresent === "true" ? { recognizedTextPresent: true } : {}),
        ...(recognizedTextPresent === "false" ? { recognizedTextPresent: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return reply.status(200).send({ ok: true, request_id: requestId, data: rows });
  });
}

function getNextDayStartInBusinessTimeZone(base: Date): Date {
  const currentDateKey = formatDateKeyInTimeZone(base);
  const currentDayStart = dateKeyRangeInBusinessTimeZone(currentDateKey).start;
  return new Date(currentDayStart.getTime() + 24 * 60 * 60 * 1000);
}

function readDateKeyQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function addDateKeyDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function diffDateKeyDays(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function clampFromDateKey(fromDate: string, toDate: string, maxDaysInclusive: number): string {
  if (fromDate > toDate) return toDate;
  const diff = diffDateKeyDays(fromDate, toDate);
  if (diff >= maxDaysInclusive) return addDateKeyDays(toDate, -(maxDaysInclusive - 1));
  return fromDate;
}

function buildTtsCostSummary(input: {
  rows: any[];
  costPerMillionCharsCents: number;
  currency: string;
}): {
  currency: string;
  costPerMillionCharsCents: number;
  generatedChars: number;
  generatedRequests: number;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  cacheHitRequests: number;
  dedupedRequests: number;
  estimatedCostCents: number;
  estimatedCost: string;
} {
  const summary = input.rows.reduce(
    (acc, row) => ({
      generatedChars: acc.generatedChars + toInt(row.generatedChars),
      generatedRequests: acc.generatedRequests + toInt(row.generatedRequests),
      totalRequests: acc.totalRequests + toInt(row.totalRequests),
      successRequests: acc.successRequests + toInt(row.successRequests),
      failedRequests: acc.failedRequests + toInt(row.failedRequests),
      cacheHitRequests: acc.cacheHitRequests + toInt(row.cacheHitRequests),
      dedupedRequests: acc.dedupedRequests + toInt(row.dedupedRequests),
    }),
    {
      generatedChars: 0,
      generatedRequests: 0,
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      cacheHitRequests: 0,
      dedupedRequests: 0,
    }
  );
  const estimatedCostCents = estimateCostCents(summary.generatedChars, input.costPerMillionCharsCents);
  return {
    currency: input.currency,
    costPerMillionCharsCents: input.costPerMillionCharsCents,
    ...summary,
    estimatedCostCents,
    estimatedCost: formatMinorCurrency(estimatedCostCents, input.currency),
  };
}

function estimateCostCents(chars: unknown, costPerMillionCharsCents: number): number {
  return Math.round(toInt(chars) * costPerMillionCharsCents / 1_000_000);
}

function formatMinorCurrency(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function toInt(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function uniqueNonEmptyStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

async function writeAuditLog(
  deps: AdminRouteDeps,
  input: {
    adminId: string;
    action: string;
    targetType: string;
    targetId?: string;
    requestId?: string;
    ip?: string;
    beforeData?: unknown;
    afterData?: unknown;
    reason?: string;
  }
): Promise<void> {
  await deps.prisma.adminAuditLog.create({
    data: {
      id: randomUUID(),
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      requestId: input.requestId ?? null,
      ip: input.ip ?? null,
      beforeData: input.beforeData === undefined ? undefined : input.beforeData,
      afterData: input.afterData === undefined ? undefined : input.afterData,
      reason: input.reason ?? null,
    },
  });
}

function computeP95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[idx] ?? null;
}

class AdminBusinessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
