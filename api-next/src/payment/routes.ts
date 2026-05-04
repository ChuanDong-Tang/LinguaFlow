import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreatePaymentOrderRequest } from "@lf/core/contracts/payment/CreatePaymentOrderContract.js";
import {
  PaymentOrderAccessDeniedError,
  PaymentOrderNotFoundError,
  type PaymentOrderService,
} from "@lf/server-next/services/payment/PaymentOrderService.js";
import type { PaymentNotifyService } from "@lf/server-next/services/payment/PaymentNotifyService.js";
import { checkWeChatPayConfig } from "@lf/server-next/providers/payment/wechat/WeChatPayConfig.js";
import { resolveUserContext, UnauthorizedError } from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";

export interface PaymentRouteDeps {
  paymentOrderService: PaymentOrderService;
  paymentNotifyService: PaymentNotifyService;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isCreatePaymentOrderRequest(value: unknown): value is CreatePaymentOrderRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.productCode === "pro_monthly";
}

export function registerPaymentRoutes(app: FastifyInstance, deps: PaymentRouteDeps): void {
  app.get("/payment/health", async (_req, reply) => {
    const wechat = checkWeChatPayConfig();

    return reply.status(wechat.ok ? 200 : 503).send({
      ok: wechat.ok,
      data: {
        provider: "wechat",
        wechat,
      },
    });
  });

  app.post("/payment/orders", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isCreatePaymentOrderRequest(req.body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid payment order payload" },
      });
    }

    const userContext = resolvePaymentUserContext(req, reply, requestId);
    if (!userContext) return;

    try {
      const data = await deps.paymentOrderService.createProMonthlyOrder({
        userId: userContext.userId,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment order failed";
      return reply.status(502).send({
        ok: false,
        request_id: requestId,
        error: { code: "PAYMENT_FAILED", message },
      });
    }
  });

  app.get("/payment/orders/:id", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const params = req.params as Partial<{ id: string }>;
    const id = params.id?.trim();

    if (!id) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Payment order id is required" },
      });
    }

    const userContext = resolvePaymentUserContext(req, reply, requestId);
    if (!userContext) return;

    try {
      const data = await deps.paymentOrderService.getOrder({
        id,
        userId: userContext.userId,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      if (
        error instanceof PaymentOrderNotFoundError ||
        error instanceof PaymentOrderAccessDeniedError
      ) {
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: { code: "RESOURCE_NOT_FOUND", message: error.message },
        });
      }

      throw error;
    }
  });

  app.post("/payment/wechat/notify", async (req, reply) => {
    const body = req.body as Partial<{ __rawBody: string }> | null;
    const rawBody = body?.__rawBody;

    if (!rawBody) {
      return reply.status(400).send({ code: "FAIL", message: "Missing raw body" });
    }

    try {
      await deps.paymentNotifyService.handleWeChatNotify({
        headers: {
          timestamp: firstHeaderValue(req.headers["wechatpay-timestamp"]),
          nonce: firstHeaderValue(req.headers["wechatpay-nonce"]),
          signature: firstHeaderValue(req.headers["wechatpay-signature"]),
          serial: firstHeaderValue(req.headers["wechatpay-serial"]),
        },
        rawBody,
      });

      return reply.status(200).send({ code: "SUCCESS", message: "成功" });
    } catch (error) {
      req.log.error({ error }, "wechat payment notify failed");
      return reply.status(500).send({ code: "FAIL", message: "失败" });
    }
  });

  app.post("/payment/wechat/refund-notify", async (req, reply) => {
    const body = req.body as Partial<{ __rawBody: string }> | null;
    const rawBody = body?.__rawBody;

    if (!rawBody) {
      return reply.status(400).send({ code: "FAIL", message: "Missing raw body" });
    }

    try {
      await deps.paymentNotifyService.handleWeChatRefundNotify({
        headers: {
          timestamp: firstHeaderValue(req.headers["wechatpay-timestamp"]),
          nonce: firstHeaderValue(req.headers["wechatpay-nonce"]),
          signature: firstHeaderValue(req.headers["wechatpay-signature"]),
          serial: firstHeaderValue(req.headers["wechatpay-serial"]),
        },
        rawBody,
      });

      return reply.status(200).send({ code: "SUCCESS", message: "成功" });
    } catch (error) {
      req.log.error({ error }, "wechat refund notify failed");
      return reply.status(500).send({ code: "FAIL", message: "失败" });
    }
  });
}

function resolvePaymentUserContext(
  req: FastifyRequest,
  reply: FastifyReply,
  requestId: string
) {
  try {
    return resolveUserContext({
      authorization: req.headers.authorization,
      mockUserId: firstHeaderValue(req.headers["x-lf-mock-user-id"]),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      void reply.status(401).send({
        ok: false,
        request_id: requestId,
        error: { code: "AUTH_UNAUTHORIZED", message: error.message },
      });
      return null;
    }

    throw error;
  }
}
