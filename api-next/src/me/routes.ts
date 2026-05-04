import type { FastifyInstance } from "fastify";
import type { EntitlementService } from "@lf/server-next/services/entitlement/EntitlementService.js";
import type { SubscriptionService } from "@lf/server-next/services/subscription/SubscriptionService.js";
import { resolveUserContext, UnauthorizedError } from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";

export interface MeRouteDeps {
  subscriptionService: SubscriptionService;
  entitlementService: EntitlementService;
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
      userContext = resolveUserContext({
        authorization: req.headers.authorization,
        mockUserId: firstHeaderValue(req.headers["x-lf-mock-user-id"]),
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
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
      userContext = resolveUserContext({
        authorization: req.headers.authorization,
        mockUserId: firstHeaderValue(req.headers["x-lf-mock-user-id"]),
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({
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
