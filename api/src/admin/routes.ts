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
    };
    aiRequestLog: {
      count: (args: any) => Promise<number>;
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

    const data = {
      user,
      currentSubscription,
      currentAutoRenew,
      orders,
      subscriptions,
      entitlements,
      autoRenewSubscriptions,
      appleIapAccountLinks,
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
    const clock = {
      serverNowIso: now.toISOString(),
      businessTimeZone: getRuntimeConfig().quotaTimeZone,
      businessDateKey: formatDateKeyInTimeZone(now),
    };
    const requestedToDate = readDateKeyQuery(query.toDate);
    const requestedFromDate = readDateKeyQuery(query.fromDate);
    const toDate = requestedToDate ?? clock.businessDateKey;
    const fromDate = clampFromDateKey(requestedFromDate ?? addDateKeyDays(toDate, -13), toDate, 90);

    const [summaryRows, recentUsage, dailyUserActivity, autoRenewSummary] = await Promise.all([
      deps.prisma.$queryRawUnsafe(
        `WITH active_users AS (
           SELECT id FROM "users" WHERE status = 'active'
         ),
         active_pro AS (
           SELECT DISTINCT "userId"
           FROM "subscriptions"
           WHERE status = 'active'
             AND "expiresAt" > now()
         ),
         today_entitlements AS (
           SELECT "userId","dailyTotalLimit","usedTotalChars"
           FROM "entitlements"
           WHERE "dateKey" = $1
         )
         SELECT
           (SELECT COUNT(*)::int FROM active_users) AS "totalUsers",
           (SELECT COUNT(*)::int FROM active_users u JOIN active_pro ap ON ap."userId" = u.id) AS "proUsers",
           (SELECT COUNT(*)::int FROM active_users u LEFT JOIN active_pro ap ON ap."userId" = u.id WHERE ap."userId" IS NULL) AS "nonProUsers",
           (SELECT COUNT(*)::int FROM today_entitlements) AS "todayQuotaUsers",
           COALESCE((SELECT ROUND(AVG("usedTotalChars")::numeric, 2)::float8 FROM today_entitlements), 0) AS "todayAvgUsedChars",
           COALESCE((SELECT SUM("usedTotalChars")::int FROM today_entitlements), 0) AS "todayTotalUsedChars",
           (SELECT COUNT(*)::int FROM today_entitlements WHERE "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit") AS "todayQuotaFullUsers"`,
        clock.businessDateKey
      ),
      deps.prisma.$queryRawUnsafe(
        `SELECT
           "dateKey",
           COUNT(*)::int AS "users",
           ROUND(AVG("usedTotalChars")::numeric, 2)::float8 AS "avgUsedChars",
           SUM("usedTotalChars")::int AS "totalUsedChars",
           COUNT(*) FILTER (WHERE "dailyTotalLimit" > 0 AND "usedTotalChars" >= "dailyTotalLimit")::int AS "quotaFullUsers"
         FROM "entitlements"
         WHERE "dateKey" >= $1
           AND "dateKey" <= $2
         GROUP BY "dateKey"
         ORDER BY "dateKey" DESC`,
        fromDate,
        toDate
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
             SELECT COUNT(DISTINCT md."userId")::int
             FROM message_days md
             WHERE md."dateKey" = to_char(d.day, 'YYYY-MM-DD')
               AND md.role = 'user'
           ) AS "usingUsers",
           (
             SELECT COUNT(DISTINCT md."userId")::int
             FROM message_days md
             WHERE md."dateKey" = to_char(d.day, 'YYYY-MM-DD')
               AND md.role = 'user'
               AND md.status = 'success'
           ) AS "activeUsers",
           (
             SELECT COUNT(DISTINCT s."userId")::int
             FROM "subscriptions" s
             JOIN "users" u ON u.id = s."userId" AND u.status = 'active'
             WHERE s.status = 'active'
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
        `SELECT provider, status, COUNT(*)::int AS count
         FROM "auto_renew_subscriptions"
         GROUP BY provider, status
         ORDER BY provider, status`
      ),
    ]);

    const data = {
      clock,
      range: { fromDate, toDate },
      summary: (summaryRows as any[])[0] ?? {},
      recentUsage,
      dailyUserActivity,
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
    const result = await deps.subscriptionService.openOrRenewPro({
      userId,
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

    const [paymentNotifyFailed24h, pendingBacklog, aiFailed24h, quotaExceeded24h, durations] = await Promise.all([
      deps.prisma.paymentEvent.count({ where: { status: "failed", createdAt: { gte: last24h } } }),
      deps.prisma.paymentOrder.count({ where: { status: "pending", createdAt: { lt: pendingCutoff } } }),
      deps.prisma.aiRequestLog.count({
        where: {
          status: { in: ["failed", "cancelled"] },
          createdAt: { gte: last24h },
        },
      }),
      deps.prisma.aiRequestLog.count({ where: { status: "quota_exceeded", createdAt: { gte: last24h } } }),
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
      apiP95Ms: p95Ms,
      thresholds: {
        paymentNotifyFailed24h: 0,
        pendingBacklog: 10,
        aiFailed24h: 20,
        quotaExceeded24h: 50,
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
    const status = typeof query.status === "string" ? query.status.trim() : "failed";
    const level = typeof query.level === "string" ? query.level.trim() : "";
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));

    const rows = await deps.prisma.$queryRawUnsafe(
      `SELECT "id","module","event","level","status","errorCode","errorMessage","userId","requestId","metadata","createdAt"
       FROM "system_event_logs"
       WHERE ($1::text IS NULL OR "module" = $1)
         AND ($2::text IS NULL OR "event" = $2)
         AND ($3::text IS NULL OR "status" = $3)
         AND ($4::text IS NULL OR "level" = $4)
       ORDER BY "createdAt" DESC
       LIMIT $5`,
      module || null,
      event || null,
      status || null,
      level || null,
      limit
    );

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
