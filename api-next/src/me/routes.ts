import type { FastifyInstance } from "fastify";
import type { EntitlementService } from "@lf/server-next/services/entitlement/EntitlementService.js";
import type { SubscriptionService } from "@lf/server-next/services/subscription/SubscriptionService.js";
import type { PaymentEntitlementRefreshService } from "@lf/server-next/services/payment/PaymentEntitlementRefreshService.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { checkIpPathRateLimit } from "../lib/rateLimit.js";

export interface MeRouteDeps {
  subscriptionService: SubscriptionService;
  entitlementService: EntitlementService;
  paymentEntitlementRefreshService: PaymentEntitlementRefreshService;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  app.get("/me/subscription", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

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
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/me/subscription" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    const subscription = await deps.subscriptionService.getCurrentSubscription(
      userContext.userId
    );

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        userId: userContext.userId,
        source: userContext.source,
        plan: subscription.plan,
        isPro: subscription.isPro,
        expiresAt: subscription.expiresAt?.toISOString() ?? null,
      },
    });
  });

  app.get("/me/entitlement", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

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
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/me/entitlement" },
        });
        return reply.status(403).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: error.message },
        });
      }

      throw error;
    }

    const data = await deps.entitlementService.getCurrentEntitlement(userContext.userId);

    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        ...data,
        source: userContext.source,
      },
    });
  });

  // 手动查单刷新权益：只对当前用户做局部补偿，不触发全局支付 worker。
  app.post("/me/entitlement/refresh", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkIpPathRateLimit({
      req,
      reply,
      requestId,
      systemEventLogRepository: deps.systemEventLogRepository,
      module: "payment",
      routeKey: "me_entitlement_refresh",
      path: "/me/entitlement/refresh",
      limit: 5,
      windowSec: 60,
      keyPrefix: "rl:payment",
      exceededEvent: "payment.entitlement_refresh.rate_limited",
      redisUnavailableEvent: "payment.entitlement_refresh.rate_limit_redis_unavailable",
      onExceeded: async () => {
        await reply.status(429).send({
          ok: false,
          request_id: requestId,
          error: { code: "RATE_LIMITED", message: "Too many refresh requests" },
        });
      },
    });
    if (!allowed) return;

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
          module: "auth",
          event: "auth.account_disabled",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          metadata: { path: "/me/entitlement/refresh" },
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
      const data = await deps.paymentEntitlementRefreshService.refreshForUser(userContext.userId);
      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          ...data,
          entitlement: {
            ...data.entitlement,
            source: userContext.source,
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh entitlement failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.entitlement_refresh.failed",
        level: "error",
        status: "failed",
        errorCode: "ENTITLEMENT_REFRESH_FAILED",
        errorMessage: message,
      });
      return reply.status(502).send({
        ok: false,
        request_id: requestId,
        error: { code: "ENTITLEMENT_REFRESH_FAILED", message: "Refresh entitlement failed" },
      });
    }
  });
}
