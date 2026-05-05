import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreatePaymentOrderRequest } from "@lf/core/contracts/payment/CreatePaymentOrderContract.js";
import {
  PaymentOrderAccessDeniedError,
  PaymentOrderNotFoundError,
  type PaymentOrderService,
} from "@lf/server-next/services/payment/PaymentOrderService.js";
import type { PaymentNotifyService } from "@lf/server-next/services/payment/PaymentNotifyService.js";
import {
  AppleIapConfigError,
  AppleIapService,
  AppleIapVerifyError,
} from "@lf/server-next/services/payment/AppleIapService.js";
import { checkWeChatPayConfig } from "@lf/server-next/providers/payment/wechat/WeChatPayConfig.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";

export interface PaymentRouteDeps {
  paymentOrderService: PaymentOrderService;
  paymentNotifyService: PaymentNotifyService;
  appleIapService: AppleIapService;
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

function isAppleVerifyTransactionRequest(
  value: unknown
): value is { transactionId: string; productCode: "pro_monthly" } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.transactionId === "string" &&
    v.transactionId.trim().length > 0 &&
    v.productCode === "pro_monthly"
  );
}

function isAppleServerNotificationRequest(
  value: unknown
): value is { signedPayload: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.signedPayload === "string" && v.signedPayload.trim().length > 0;
}

function isCreatePaymentOrderRequest(value: unknown): value is CreatePaymentOrderRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.productCode === "pro_monthly";
}

export function registerPaymentRoutes(app: FastifyInstance, deps: PaymentRouteDeps): void {
  app.get("/payment/health", async (_req, reply) => {
    const wechat = checkWeChatPayConfig();
    const appleIap = { ok: deps.appleIapService.isConfigured() };

    return reply.status(wechat.ok ? 200 : 503).send({
      ok: wechat.ok,
      data: {
        provider: "wechat",
        wechat,
        appleIap,
      },
    });
  });

  app.post("/payment/orders", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isCreatePaymentOrderRequest(req.body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.orders.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid payment order payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;

    try {
      const data = await deps.paymentOrderService.createProMonthlyOrder({
        userId: userContext.userId,
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment order failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.orders.create_failed",
        level: "error",
        status: "failed",
        errorCode: "PAYMENT_FAILED",
        errorMessage: message,
      });
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
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.orders.missing_id",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Payment order id is required" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
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
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          module: "payment",
          event: "payment.orders.query_failed",
          level: "warn",
          status: "failed",
          errorCode: "RESOURCE_NOT_FOUND",
          errorMessage: error.message,
          metadata: { orderId: id },
        });
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
      await writeSystemEventLog(deps.systemEventLogRepository, {
        module: "payment",
        event: "payment.notify.missing_raw_body",
        level: "warn",
        status: "failed",
        errorCode: "PAYMENT_NOTIFY_INVALID",
        metadata: { path: "/payment/wechat/notify" },
      });
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
      const message = error instanceof Error ? error.message : "WeChat payment notify failed";
      req.log.error({ error }, "wechat payment notify failed");
      await writeSystemEventLog(deps.systemEventLogRepository, {
        module: "payment",
        event: "payment.notify.failed",
        level: "error",
        status: "failed",
        errorCode: "PAYMENT_NOTIFY_FAILED",
        errorMessage: message,
        metadata: { path: "/payment/wechat/notify" },
      });
      return reply.status(500).send({ code: "FAIL", message: "失败" });
    }
  });

  app.post("/payment/wechat/refund-notify", async (req, reply) => {
    const body = req.body as Partial<{ __rawBody: string }> | null;
    const rawBody = body?.__rawBody;

    if (!rawBody) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        module: "payment",
        event: "payment.refund_notify.missing_raw_body",
        level: "warn",
        status: "failed",
        errorCode: "PAYMENT_NOTIFY_INVALID",
        metadata: { path: "/payment/wechat/refund-notify" },
      });
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
      const message = error instanceof Error ? error.message : "WeChat refund notify failed";
      req.log.error({ error }, "wechat refund notify failed");
      await writeSystemEventLog(deps.systemEventLogRepository, {
        module: "payment",
        event: "payment.refund_notify.failed",
        level: "error",
        status: "failed",
        errorCode: "PAYMENT_NOTIFY_FAILED",
        errorMessage: message,
        metadata: { path: "/payment/wechat/refund-notify" },
      });
      return reply.status(500).send({ code: "FAIL", message: "失败" });
    }
  });

  app.post("/payment/ios/verify-transaction", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isAppleVerifyTransactionRequest(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.ios.verify.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid iOS verify payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;

    try {
      const data = await deps.appleIapService.verifyProMonthlyTransaction({
        userId: userContext.userId,
        transactionId: body.transactionId.trim(),
      });

      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "iOS IAP verify failed";
      if (error instanceof AppleIapConfigError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          module: "payment",
          event: "payment.ios.verify.not_configured",
          level: "warn",
          status: "failed",
          errorCode: error.code,
          errorMessage: message,
        });
        return reply.status(503).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message },
        });
      }

      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.verify.failed",
        level: "warn",
        status: "failed",
        errorCode: error instanceof AppleIapVerifyError ? error.code : "IAP_VERIFY_FAILED",
        errorMessage: message,
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "IAP_VERIFY_FAILED", message },
      });
    }
  });

  app.post("/payment/ios/notify", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isAppleServerNotificationRequest(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.ios.notify.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid iOS notify payload" },
      });
    }

    try {
      await deps.appleIapService.handleServerNotification({
        signedPayload: body.signedPayload,
      });
      return reply.status(200).send({ ok: true, request_id: requestId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "iOS notify failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.ios.notify.failed",
        level: "error",
        status: "failed",
        errorCode: "IAP_NOTIFY_FAILED",
        errorMessage: message,
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "IAP_NOTIFY_FAILED", message },
      });
    }
  });
}

async function resolvePaymentUserContext(
  req: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
  deps: PaymentRouteDeps
) {
  try {
    return await resolveActiveUserContext({
      authorization: req.headers.authorization,
      userRepository: deps.userRepository,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.auth.unauthorized",
        level: "warn",
        status: "failed",
        errorCode: "AUTH_UNAUTHORIZED",
        errorMessage: error.message,
      });
      void reply.status(401).send({
        ok: false,
        request_id: requestId,
        error: { code: "AUTH_UNAUTHORIZED", message: error.message },
      });
      return null;
    }
    if (error instanceof AccountDisabledError) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.account_disabled",
        level: "warn",
        status: "failed",
        errorCode: "ACCOUNT_DISABLED",
        metadata: { path: req.url },
      });
      void reply.status(403).send({
        ok: false,
        request_id: requestId,
        error: { code: error.code, message: error.message },
      });
      return null;
    }

    throw error;
  }
}
