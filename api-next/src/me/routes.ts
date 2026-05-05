import type { FastifyInstance } from "fastify";
import type { EntitlementService } from "@lf/server-next/services/entitlement/EntitlementService.js";
import type { SubscriptionService } from "@lf/server-next/services/subscription/SubscriptionService.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";

export interface MeRouteDeps {
  subscriptionService: SubscriptionService;
  entitlementService: EntitlementService;
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
}
