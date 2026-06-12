import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreatePaymentOrderRequest } from "@lf/core/contracts/payment/CreatePaymentOrderContract.js";
import {
  PaymentOrderAccessDeniedError,
  PaymentOrderNotFoundError,
  ProRenewalTooEarlyError,
  type PaymentOrderService,
} from "@lf/server/services/payment/PaymentOrderService.js";
import type { PaymentNotifyService } from "@lf/server/services/payment/PaymentNotifyService.js";
import {
  AutoRenewAccessDeniedError,
  AutoRenewAlreadyActiveError,
  AutoRenewConcurrentCreateError,
  AutoRenewNotFoundError,
  AutoRenewSwitchBlockedError,
  type AutoRenewService,
} from "@lf/server/services/payment/AutoRenewService.js";
import { AppleIapService } from "@lf/server/providers/payment/apple/AppleIapService.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import {
  AppleIapConfigError,
  AppleIapSubscriptionAlreadyBoundError,
  AppleIapVerifyError,
} from "@lf/server/providers/payment/apple/AppleIapErrors.js";
import { checkWeChatPayConfig } from "@lf/server/providers/payment/wechat/WeChatPayConfig.js";
import {
  AccountDisabledError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import { resolveRequestId } from "../lib/httpResult.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { checkIpPathRateLimit } from "../lib/rateLimit.js";

export interface PaymentRouteDeps {
  paymentOrderService: PaymentOrderService;
  paymentNotifyService: PaymentNotifyService;
  autoRenewService: AutoRenewService;
  appleIapService: AppleIapService;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

const CLIENT_ERROR_MESSAGES = {
  PAYMENT_FAILED: "Payment request failed, please try again later.",
  PRO_RENEWAL_TOO_EARLY: "Pro can be prepaid for at most 2 months.",
  RESOURCE_NOT_FOUND: "Payment order not found.",
  IAP_VERIFY_FAILED: "Unable to verify purchase at the moment.",
  APPLE_SUBSCRIPTION_ALREADY_BOUND: "This Apple subscription is already bound to another OIO account.",
  IAP_NOTIFY_FAILED: "Notification processing failed.",
  AUTH_UNAUTHORIZED: "Authentication required.",
  ACCOUNT_DISABLED: "Account is unavailable.",
  AUTO_RENEW_NOT_FOUND: "Auto renew subscription not found.",
  AUTO_RENEW_ALREADY_ACTIVE: "Auto renew is already active.",
  AUTO_RENEW_SWITCH_BLOCKED: "Current Pro period is still active. Switch auto renew after it expires.",
} as const;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatCnyPrice(amountCents: number): string {
  const yuan = amountCents / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function isAppleVerifyTransactionRequest(
  value: unknown
): value is { transactionId: string; } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.transactionId === "string" && v.transactionId.trim().length > 0
  );
}

function isAppleAppAccountTokenRequest(
  value: unknown
): value is { appAccountToken: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.appAccountToken === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v.appAccountToken.trim()
    )
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

function isCancelAutoRenewRequest(value: unknown): value is { autoRenewSubscriptionId: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.autoRenewSubscriptionId === "string" &&
    v.autoRenewSubscriptionId.trim().length > 0
  );
}

function isCreateWechatAutoRenewRequest(value: unknown): value is { productCode: "pro_monthly" } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.productCode === "pro_monthly";
}

export function registerPaymentRoutes(app: FastifyInstance, deps: PaymentRouteDeps): void {
  const config = getRuntimeConfig();
  app.get("/payment/health", async (_req, reply) => {
    const wechat = checkWeChatPayConfig();
    const appleIap = { ok: deps.appleIapService.isConfigured() };
    const providers = {
      wechat: {
        ok: !config.payment.wechatPayEnabled || wechat.ok,
        enabled: config.payment.wechatPayEnabled,
        detail: config.payment.wechatPayEnabled ? wechat : { disabled: true },
      },
      ios: {
        ok: !config.payment.appleIap.enabled || appleIap.ok,
        enabled: config.payment.appleIap.enabled,
        detail: config.payment.appleIap.enabled ? appleIap : { disabled: true },
      },
    };
    const ok = providers.wechat.ok && providers.ios.ok;

    return reply.status(ok ? 200 : 503).send({
      ok,
      data: {
        providers,
      },
    });
  });

  app.get("/payment/products/pro-monthly", async (_req, reply) => {
    return reply.status(200).send({
      ok: true,
      data: {
        productCode: "pro_monthly",
        amount: config.payment.proMonthlyPriceCents,
        currency: "CNY",
        displayPrice: formatCnyPrice(config.payment.proMonthlyPriceCents),
      },
    });
  });

  app.get("/payment/autorenew/current", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;

    try {
      const reconcileResult = await deps.appleIapService.reconcileCurrentAutoRenewForUser(userContext.userId);
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.autorenew.reconcile_checked",
        level: "warn",
        status: reconcileResult.status === "checked" && reconcileResult.action === "cancelled"
          ? "success"
          : "ignored",
        errorCode: "APPLE_AUTORENEW_RECONCILE_CHECKED",
        metadata: { appleAutoRenewReconcile: reconcileResult },
      });
    } catch (error) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.autorenew.reconcile_failed",
        level: "warn",
        status: "failed",
        errorCode: "APPLE_AUTORENEW_RECONCILE_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    const data = await deps.autoRenewService.getCurrent(userContext.userId);
    return reply.status(200).send({
      ok: true,
      request_id: requestId,
      data: {
        subscription: data.subscription
          ? {
              id: data.subscription.id,
              provider: data.subscription.provider,
              productCode: data.subscription.productCode,
              status: data.subscription.status,
              currentPeriodStart: data.subscription.currentPeriodStart?.toISOString() ?? null,
              currentPeriodEnd: data.subscription.currentPeriodEnd?.toISOString() ?? null,
              nextBillingAt: data.subscription.nextBillingAt?.toISOString() ?? null,
              cancelledAt: data.subscription.cancelledAt?.toISOString() ?? null,
            }
          : null,
      },
    });
  });

  app.post("/payment/autorenew/wechat/pre-sign", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!isCreateWechatAutoRenewRequest(req.body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.autorenew.wechat.pre_sign_invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid auto renew payload" },
      });
    }
    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;
    if (!config.payment.appleIap.enabled) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.verify.disabled",
        level: "warn",
        status: "failed",
        errorCode: "APPLE_IAP_DISABLED",
      });
      return reply.status(503).send({
        ok: false,
        request_id: requestId,
        error: { code: "APPLE_IAP_DISABLED", message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
      });
    }

    try {
      const data = await deps.autoRenewService.createWeChatPreSign({
        userId: userContext.userId,
      });
      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          autoRenewSubscriptionId: data.subscription.id,
          provider: data.subscription.provider,
          outContractCode: data.outContractCode,
          providerOrderId: data.providerOrderId,
          clientPayParams: data.clientPayParams,
          redirectUrl: data.redirectUrl,
        },
      });
    } catch (error) {
      if (
        error instanceof AutoRenewAlreadyActiveError ||
        error instanceof AutoRenewConcurrentCreateError ||
        error instanceof AutoRenewSwitchBlockedError ||
        error instanceof ProRenewalTooEarlyError
      ) {
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: {
            code: error.code,
            message:
              error instanceof AutoRenewAlreadyActiveError
                ? `Auto renew is already active via ${error.provider}.`
                : error instanceof AutoRenewSwitchBlockedError
                  // 用户取消自动续费后，当前 Pro 仍未过期；这里明确返回业务冲突，不当成支付/签约失败。
                  ? CLIENT_ERROR_MESSAGES.AUTO_RENEW_SWITCH_BLOCKED
                  : error instanceof ProRenewalTooEarlyError
                    ? CLIENT_ERROR_MESSAGES.PRO_RENEWAL_TOO_EARLY
                  : "Auto renew is already active.",
            ...(error instanceof AutoRenewSwitchBlockedError
              ? {
                  provider: error.provider,
                  currentPeriodEnd: error.currentPeriodEnd.toISOString(),
                }
              : {}),
            ...(error instanceof ProRenewalTooEarlyError
              ? {
                  expiresAt: error.expiresAt.toISOString(),
                }
              : {}),
          },
        });
      }
      const message = error instanceof Error ? error.message : "Auto renew pre sign failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.autorenew.wechat.pre_sign_failed",
        level: "error",
        status: "failed",
        errorCode: "AUTO_RENEW_PRE_SIGN_FAILED",
        errorMessage: message,
      });
      return reply.status(502).send({
        ok: false,
        request_id: requestId,
        error: { code: "AUTO_RENEW_PRE_SIGN_FAILED", message: "Auto renew request failed" },
      });
    }
  });

  app.post("/payment/autorenew/cancel", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!isCancelAutoRenewRequest(req.body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.autorenew.cancel_invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid auto renew cancel payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;
    if (!config.payment.appleIap.enabled) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.app_account_token.disabled",
        level: "warn",
        status: "failed",
        errorCode: "APPLE_IAP_DISABLED",
      });
      return reply.status(503).send({
        ok: false,
        request_id: requestId,
        error: { code: "APPLE_IAP_DISABLED", message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
      });
    }

    try {
      const subscription = await deps.autoRenewService.cancelWithProvider({
        userId: userContext.userId,
        autoRenewSubscriptionId: req.body.autoRenewSubscriptionId.trim(),
      });

      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          id: subscription.id,
          provider: subscription.provider,
          status: subscription.status,
          cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof AutoRenewNotFoundError ||
        error instanceof AutoRenewAccessDeniedError
      ) {
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: {
            code: "AUTO_RENEW_NOT_FOUND",
            message: CLIENT_ERROR_MESSAGES.AUTO_RENEW_NOT_FOUND,
          },
        });
      }
      const message = error instanceof Error ? error.message : "Auto renew cancel failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.autorenew.cancel_failed",
        level: "error",
        status: "failed",
        errorCode: "AUTO_RENEW_CANCEL_FAILED",
        errorMessage: message,
        metadata: { autoRenewSubscriptionId: req.body.autoRenewSubscriptionId.trim() },
      });
      return reply.status(502).send({
        ok: false,
        request_id: requestId,
        error: { code: "AUTO_RENEW_CANCEL_FAILED", message: "Auto renew cancel failed" },
      });
    }
  });

  app.post("/payment/autorenew/wechat/contract-notify", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const body = req.body as Partial<{ __rawBody: string }> | null;
    const rawBody = body?.__rawBody;
    if (!rawBody) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.autorenew.wechat.contract_notify_missing_raw_body",
        level: "warn",
        status: "failed",
        errorCode: "PAYMENT_NOTIFY_INVALID",
        metadata: { path: "/payment/autorenew/wechat/contract-notify" },
      });
      return reply.status(400).send({ code: "FAIL", message: "Missing raw body" });
    }

    try {
      await deps.paymentNotifyService.verifyWeChatNotifySignature({
        headers: {
          timestamp: firstHeaderValue(req.headers["wechatpay-timestamp"]),
          nonce: firstHeaderValue(req.headers["wechatpay-nonce"]),
          signature: firstHeaderValue(req.headers["wechatpay-signature"]),
          serial: firstHeaderValue(req.headers["wechatpay-serial"]),
        },
        rawBody,
      });
      await deps.autoRenewService.handleWeChatContractRawNotify(rawBody);
      return reply.status(200).send({ code: "SUCCESS", message: "成功" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WeChat contract notify failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.autorenew.wechat.contract_notify_failed",
        level: "error",
        status: "failed",
        errorCode: "AUTO_RENEW_NOTIFY_FAILED",
        errorMessage: message,
      });
      return reply.status(500).send({ code: "FAIL", message: "失败" });
    }
  });

  app.post("/payment/autorenew/wechat/debit-notify", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const body = req.body as Partial<{ __rawBody: string }> | null;
    const rawBody = body?.__rawBody;
    if (!rawBody) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.autorenew.wechat.debit_notify_missing_raw_body",
        level: "warn",
        status: "failed",
        errorCode: "PAYMENT_NOTIFY_INVALID",
        metadata: { path: "/payment/autorenew/wechat/debit-notify" },
      });
      return reply.status(400).send({ code: "FAIL", message: "Missing raw body" });
    }

    try {
      await deps.paymentNotifyService.verifyWeChatNotifySignature({
        headers: {
          timestamp: firstHeaderValue(req.headers["wechatpay-timestamp"]),
          nonce: firstHeaderValue(req.headers["wechatpay-nonce"]),
          signature: firstHeaderValue(req.headers["wechatpay-signature"]),
          serial: firstHeaderValue(req.headers["wechatpay-serial"]),
        },
        rawBody,
      });
      await deps.autoRenewService.handleWeChatDebitRawNotify(rawBody);
      return reply.status(200).send({ code: "SUCCESS", message: "成功" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WeChat debit notify failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.autorenew.wechat.debit_notify_failed",
        level: "error",
        status: "failed",
        errorCode: "AUTO_RENEW_NOTIFY_FAILED",
        errorMessage: message,
      });
      return reply.status(500).send({ code: "FAIL", message: "失败" });
    }
  });

  app.post("/payment/orders", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req,
      reply,
      requestId,
      rule: {
        routeKey: "orders_create",
        path: "/payment/orders",
        limit: config.payment.rateLimitOrdersCreateLimit,
        windowSec: config.payment.rateLimitOrdersCreateWindowSec,
        responseType: "api",
      },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

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
      if (error instanceof ProRenewalTooEarlyError) {
        // 已有 Pro 时不创建新的单次月卡订单，避免单买和订阅叠加。
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: {
            code: error.code,
            message: CLIENT_ERROR_MESSAGES.PRO_RENEWAL_TOO_EARLY,
            expiresAt: error.expiresAt.toISOString(),
          },
        });
      }
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
        error: { code: "PAYMENT_FAILED", message: CLIENT_ERROR_MESSAGES.PAYMENT_FAILED },
      });
    }
  });

  app.get("/payment/orders/:id", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req,
      reply,
      requestId,
      rule: {
        routeKey: "orders_query",
        path: "/payment/orders/:id",
        limit: config.payment.rateLimitOrdersQueryLimit,
        windowSec: config.payment.rateLimitOrdersQueryWindowSec,
        responseType: "api",
      },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
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
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: CLIENT_ERROR_MESSAGES.RESOURCE_NOT_FOUND,
          },
        });
      }

      throw error;
    }
  });

  app.post("/payment/wechat/notify", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req,
      reply,
      requestId,
      rule: {
        routeKey: "wechat_notify",
        path: "/payment/wechat/notify",
        limit: config.payment.rateLimitWebhookLimit,
        windowSec: config.payment.rateLimitWebhookWindowSec,
        responseType: "webhook",
      },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
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
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req,
      reply,
      requestId,
      rule: {
        routeKey: "wechat_refund_notify",
        path: "/payment/wechat/refund-notify",
        limit: config.payment.rateLimitWebhookLimit,
        windowSec: config.payment.rateLimitWebhookWindowSec,
        responseType: "webhook",
      },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
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
      if (error instanceof AutoRenewSwitchBlockedError) {
        // Apple 首次验单也要遵守同一条规则：取消旧渠道后，当前 Pro 周期内不能马上换渠道重签。
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: {
            code: error.code,
            message: CLIENT_ERROR_MESSAGES.AUTO_RENEW_SWITCH_BLOCKED,
            provider: error.provider,
            currentPeriodEnd: error.currentPeriodEnd.toISOString(),
          },
        });
      }
      if (error instanceof ProRenewalTooEarlyError) {
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: {
            code: error.code,
            message: CLIENT_ERROR_MESSAGES.PRO_RENEWAL_TOO_EARLY,
            expiresAt: error.expiresAt.toISOString(),
          },
        });
      }
      if (error instanceof AppleIapSubscriptionAlreadyBoundError) {
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: {
            code: error.code,
            message: CLIENT_ERROR_MESSAGES.APPLE_SUBSCRIPTION_ALREADY_BOUND,
            originalTransactionId: error.originalTransactionId,
          },
        });
      }
      if (error instanceof AppleIapConfigError) {
        const configError = error as AppleIapConfigError;
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          module: "payment",
          event: "payment.ios.verify.not_configured",
          level: "warn",
          status: "failed",
          errorCode: configError.code,
          errorMessage: message,
        });
        return reply.status(503).send({
          ok: false,
          request_id: requestId,
          error: { code: configError.code, message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
        });
      }

      const verifyErrorCode =
        error instanceof AppleIapVerifyError
          ? (error as AppleIapVerifyError).code
          : "IAP_VERIFY_FAILED";
      const verifyErrorDetails =
        error instanceof AppleIapVerifyError
          ? (error as AppleIapVerifyError).details
          : null;
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.verify.failed",
        level: "warn",
        status: "failed",
        errorCode: verifyErrorCode,
        errorMessage: message,
        metadata: verifyErrorDetails
          ? {
              appleIapVerify: verifyErrorDetails,
            }
          : undefined,
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: verifyErrorCode, message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
      });
    }
  });

  app.post("/payment/ios/app-account-token", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isAppleAppAccountTokenRequest(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.ios.app_account_token.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid iOS app account token payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;

    try {
      const data = await deps.appleIapService.registerAppAccountToken({
        userId: userContext.userId,
        appAccountToken: body.appAccountToken.trim(),
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "iOS app account token registration failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.ios.app_account_token.failed",
        level: "error",
        status: "failed",
        errorCode: "APPLE_IAP_APP_ACCOUNT_TOKEN_FAILED",
        errorMessage: message,
      });
      return reply.status(500).send({
        ok: false,
        request_id: requestId,
        error: {
          code: "APPLE_IAP_APP_ACCOUNT_TOKEN_FAILED",
          message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED,
        },
      });
    }
  });

  app.post("/payment/ios/notify", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req,
      reply,
      requestId,
      rule: {
        routeKey: "ios_notify",
        path: "/payment/ios/notify",
        limit: config.payment.rateLimitWebhookLimit,
        windowSec: config.payment.rateLimitWebhookWindowSec,
        responseType: "api",
      },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
    if (!config.payment.appleIap.enabled) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.ios.notify.disabled",
        level: "warn",
        status: "failed",
        errorCode: "APPLE_IAP_DISABLED",
      });
      return reply.status(503).send({
        ok: false,
        request_id: requestId,
        error: { code: "APPLE_IAP_DISABLED", message: CLIENT_ERROR_MESSAGES.IAP_NOTIFY_FAILED },
      });
    }

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
        error: { code: "IAP_NOTIFY_FAILED", message: CLIENT_ERROR_MESSAGES.IAP_NOTIFY_FAILED },
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
        error: { code: "AUTH_UNAUTHORIZED", message: CLIENT_ERROR_MESSAGES.AUTH_UNAUTHORIZED },
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
        error: { code: error.code, message: CLIENT_ERROR_MESSAGES.ACCOUNT_DISABLED },
      });
      return null;
    }

    throw error;
  }
}

type PaymentRateLimitRule = {
  routeKey:
    | "wechat_notify"
    | "wechat_refund_notify"
    | "ios_notify"
    | "orders_create"
    | "orders_query";
  path:
    | "/payment/wechat/notify"
    | "/payment/wechat/refund-notify"
    | "/payment/ios/notify"
    | "/payment/orders"
    | "/payment/orders/:id";
  limit: number;
  windowSec: number;
  responseType: "webhook" | "api";
};

async function checkPaymentRateLimit(input: {
  req: FastifyRequest;
  reply: FastifyReply;
  requestId?: string;
  rule: PaymentRateLimitRule;
  systemEventLogRepository?: SystemEventLogWriter;
}): Promise<boolean> {
  return checkIpPathRateLimit({
    req: input.req,
    reply: input.reply,
    requestId: input.requestId,
    systemEventLogRepository: input.systemEventLogRepository,
    module: "payment",
    routeKey: input.rule.routeKey,
    path: input.rule.path,
    limit: input.rule.limit,
    windowSec: input.rule.windowSec,
    keyPrefix: "rl:payment",
    exceededEvent: "payment.rate_limit.exceeded",
    redisUnavailableEvent: "payment.rate_limit.redis_unavailable",
    onExceeded: async () => {
      if (input.rule.responseType === "webhook") {
        await input.reply.status(429).send({ code: "RATE_LIMITED", message: "Too many requests" });
        return;
      }
      await input.reply.status(429).send({
        ok: false,
        request_id: input.requestId ?? null,
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      });
    },
  });
}
