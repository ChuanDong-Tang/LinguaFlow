import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { ProRenewalTooEarlyError } from "@lf/server/services/payment/ProPrepaidLimit.js";
import {
  AutoRenewAccessDeniedError,
  AutoRenewAlreadyActiveError,
  AutoRenewConcurrentCreateError,
  AutoRenewNotFoundError,
  AutoRenewSwitchBlockedError,
  type AutoRenewService,
} from "@lf/server/services/payment/AutoRenewService.js";
import { AppleIapService } from "@lf/server/providers/payment/apple/AppleIapService.js";
import { GooglePlayBillingService } from "@lf/server/providers/payment/google/GooglePlayBillingService.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";
import {
  AppleIapConfigError,
  AppleIapSubscriptionAlreadyBoundError,
  AppleIapVerifyError,
} from "@lf/server/providers/payment/apple/AppleIapErrors.js";
import {
  GooglePlayBillingConfigError,
  GooglePlayBillingVerifyError,
  GooglePlaySubscriptionAlreadyBoundError,
} from "@lf/server/providers/payment/google/GooglePlayBillingErrors.js";
import { fetchGoogleApi } from "@lf/server/providers/payment/google/GoogleApiHttpClient.js";
import type { AlipayAutoRenewService } from "@lf/server/providers/payment/alipay/AlipayAutoRenewService.js";
import { AlipayApiError } from "@lf/server/providers/payment/alipay/AlipayClient.js";
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
  autoRenewService: AutoRenewService;
  appleIapService: AppleIapService;
  googlePlayBillingService: GooglePlayBillingService;
  alipayAutoRenewService: AlipayAutoRenewService;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      nickname: string | null;
      email: string | null;
      phone: string | null;
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
  GOOGLE_PLAY_SUBSCRIPTION_ALREADY_BOUND: "This Google Play subscription is already bound to another OIO account.",
  IAP_NOTIFY_FAILED: "Notification processing failed.",
  AUTH_UNAUTHORIZED: "Authentication required.",
  ACCOUNT_DISABLED: "Account is unavailable.",
  AUTO_RENEW_NOT_FOUND: "Auto renew subscription not found.",
  AUTO_RENEW_ALREADY_ACTIVE: "Auto renew is already active.",
  AUTO_RENEW_SWITCH_BLOCKED: "Current membership period is still active. Switch auto renew after it expires.",
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

function isGooglePlayVerifyPurchaseRequest(
  value: unknown
): value is { productId: string; purchaseToken: string; obfuscatedAccountId?: string | null } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.productId === "string" &&
    v.productId.trim().length > 0 &&
    typeof v.purchaseToken === "string" &&
    v.purchaseToken.trim().length > 0 &&
    (v.obfuscatedAccountId === undefined ||
      v.obfuscatedAccountId === null ||
      typeof v.obfuscatedAccountId === "string")
  );
}

function isGooglePlayObfuscatedAccountIdRequest(
  value: unknown
): value is { obfuscatedAccountId: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.obfuscatedAccountId === "string" && v.obfuscatedAccountId.trim().length > 0;
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

function isGooglePlayNotificationRequest(
  value: unknown
): value is { message?: { messageId?: string; data?: string }; subscription?: string } {
  return Boolean(value && typeof value === "object");
}

function isCancelAutoRenewRequest(value: unknown): value is { autoRenewSubscriptionId: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.autoRenewSubscriptionId === "string" &&
    v.autoRenewSubscriptionId.trim().length > 0
  );
}

const isResumeAutoRenewRequest = isCancelAutoRenewRequest;

const isCreateAlipayAutoRenewRequest = (value: unknown): value is { productCode: "plus_monthly" | "pro_monthly" } => {
  if (!value || typeof value !== "object") return false;
  return isPaymentProductCode((value as Record<string, unknown>).productCode);
};

function isPaymentProductCode(value: unknown): value is "plus_monthly" | "pro_monthly" {
  return value === "plus_monthly" || value === "pro_monthly";
}

export function registerPaymentRoutes(app: FastifyInstance, deps: PaymentRouteDeps): void {
  const config = getRuntimeConfig();
  app.get("/payment/health", async (_req, reply) => {
    const appleIap = { ok: deps.appleIapService.isConfigured() };
    const googlePlayBillingConfigured = deps.googlePlayBillingService.isConfigured();
    const googlePlayNotificationOidcConfigured = Boolean(
      config.payment.googlePlayBilling.notifyOidcAudience &&
        config.payment.googlePlayBilling.notifyOidcServiceAccountEmail
    );
    const googlePlay = {
      ok:
        googlePlayBillingConfigured &&
        Boolean(config.payment.googlePlayBilling.notifyToken) &&
        (!config.isProduction || googlePlayNotificationOidcConfigured),
      billingConfigured: googlePlayBillingConfigured,
      notificationAuthConfigured: Boolean(config.payment.googlePlayBilling.notifyToken),
      notificationOidcConfigured: googlePlayNotificationOidcConfigured,
    };
    const providers = {
      ios: {
        ok: !config.payment.appleIap.enabled || appleIap.ok,
        enabled: config.payment.appleIap.enabled,
        detail: config.payment.appleIap.enabled ? appleIap : { disabled: true },
      },
      googlePlay: {
        ok: !config.payment.googlePlayBilling.enabled || googlePlay.ok,
        enabled: config.payment.googlePlayBilling.enabled,
        detail: config.payment.googlePlayBilling.enabled ? googlePlay : { disabled: true },
      },
      alipay: {
        ok: !config.payment.alipayAutoRenew.enabled || deps.alipayAutoRenewService.isConfigured(),
        enabled: config.payment.alipayAutoRenew.enabled,
        detail: deps.alipayAutoRenewService.isConfigured() ? { configured: true } : { configured: false },
      },
    };
    const ok = providers.ios.ok && providers.googlePlay.ok && providers.alipay.ok;

    return reply.status(ok ? 200 : 503).send({
      ok,
      data: {
        providers,
      },
    });
  });

  app.get("/payment/products/pro-monthly", async (_req, reply) => {
    const quote = await getAlipayProductQuoteOrNull(app, deps, "pro_monthly");
    return reply.status(200).send({
      ok: true,
      data: {
        productCode: "pro_monthly",
        amount: quote?.amount ?? null,
        currency: quote?.currency ?? "CNY",
        displayPrice: quote ? formatCnyPrice(quote.amount) : null,
        monthlyTokenLimit: config.proMonthlyTokenLimit,
        monthlyImageUploadBytes: config.proImageStorageBytes,
      },
    });
  });

  app.get("/payment/products/plus-monthly", async (_req, reply) => {
    const quote = await getAlipayProductQuoteOrNull(app, deps, "plus_monthly");
    return reply.status(200).send({
      ok: true,
      data: {
        productCode: "plus_monthly",
        amount: quote?.amount ?? null,
        currency: quote?.currency ?? "CNY",
        displayPrice: quote ? formatCnyPrice(quote.amount) : null,
        monthlyTokenLimit: config.plusMonthlyTokenLimit,
        monthlyImageUploadBytes: config.plusImageStorageBytes,
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
        level: "info",
        status: reconcileResult.status === "checked" && reconcileResult.action !== "kept"
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

    try {
      const reconcileResult = await deps.googlePlayBillingService.reconcileCurrentAutoRenewForUser(
        userContext.userId
      );
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.google_play.autorenew.reconcile_checked",
        level: "info",
        status:
          reconcileResult.status === "checked" && reconcileResult.action !== "unchanged"
            ? "success"
            : "ignored",
        errorCode: "GOOGLE_PLAY_AUTORENEW_RECONCILE_CHECKED",
        metadata: { googlePlayAutoRenewReconcile: reconcileResult },
      });
    } catch (error) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.google_play.autorenew.reconcile_failed",
        level: "warn",
        status: "failed",
        errorCode: "GOOGLE_PLAY_AUTORENEW_RECONCILE_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const reconcileResult = await deps.alipayAutoRenewService.reconcileCurrentAutoRenewForUser(
        userContext.userId
      );
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.alipay.autorenew.reconcile_checked",
        level: "info",
        status:
          reconcileResult.status === "checked" && reconcileResult.action !== "unchanged"
            ? "success"
            : "ignored",
        errorCode: "ALIPAY_AUTORENEW_RECONCILE_CHECKED",
        metadata: { alipayAutoRenewReconcile: reconcileResult },
      });
    } catch (error) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.alipay.autorenew.reconcile_failed",
        level: "warn",
        status: "failed",
        errorCode: "ALIPAY_AUTORENEW_RECONCILE_FAILED",
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
              cancelAtPeriodEnd: readCancelAtPeriodEnd(data.subscription.metadata),
            }
          : null,
      },
    });
  });

  app.post("/payment/autorenew/alipay/create", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req, reply, requestId,
      rule: { routeKey: "alipay_create", path: "/payment/autorenew/alipay/create", limit: config.payment.rateLimitOrdersCreateLimit, windowSec: config.payment.rateLimitOrdersCreateWindowSec, responseType: "api" },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
    if (!isCreateAlipayAutoRenewRequest(req.body)) {
      return reply.status(400).send({ ok: false, request_id: requestId, error: { code: "VALIDATION_FAILED", message: "Invalid Alipay subscription payload" } });
    }
    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;
    const user = await deps.userRepository.findById(userContext.userId);
    if (!user) return reply.status(404).send({ ok: false, request_id: requestId, error: { code: "USER_NOT_FOUND", message: "User not found" } });
    try {
      const result = await deps.alipayAutoRenewService.create({
        userId: user.id, nickname: user.nickname, email: user.email, phone: user.phone, productCode: req.body.productCode,
      });
      return reply.status(200).send({
        ok: true, request_id: requestId,
        data: { autoRenewSubscriptionId: result.subscription.id, provider: "alipay", jumpSchema: result.jumpSchema, reused: result.reused },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = error instanceof AutoRenewAlreadyActiveError || error instanceof AutoRenewConcurrentCreateError || error instanceof ProRenewalTooEarlyError;
      const errorCode = error instanceof AutoRenewAlreadyActiveError || error instanceof AutoRenewConcurrentCreateError || error instanceof ProRenewalTooEarlyError
        ? error.code
        : message.split(":")[0] || "ALIPAY_AUTORENEW_CREATE_FAILED";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: user.id,
        module: "payment",
        event: "payment.autorenew.alipay.create_failed",
        level: conflict ? "warn" : "error",
        status: "failed",
        errorCode,
        errorMessage: message,
        metadata: error instanceof AlipayApiError ? sanitizeAlipayErrorDetails(error.details) : undefined,
      });
      return reply.status(conflict ? 409 : 502).send({ ok: false, request_id: requestId, error: { code: errorCode, message: error instanceof ProRenewalTooEarlyError ? CLIENT_ERROR_MESSAGES.AUTO_RENEW_SWITCH_BLOCKED : conflict ? "Unable to start another subscription right now." : "Alipay subscription request failed" } });
    }
  });

  app.post("/payment/autorenew/alipay/notify", async (req, reply) => {
    const allowed = await checkPaymentRateLimit({
      req, reply,
      rule: { routeKey: "alipay_notify", path: "/payment/autorenew/alipay/notify", limit: config.payment.rateLimitWebhookLimit, windowSec: config.payment.rateLimitWebhookWindowSec, responseType: "webhook" },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
    const fields = req.body && typeof req.body === "object" ? req.body as Record<string, string> : null;
    if (!fields) return reply.type("text/plain").status(400).send("fail");
    try {
      await deps.alipayAutoRenewService.handleNotification(fields);
      return reply.type("text/plain").status(200).send("success");
    } catch (error) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId: resolveRequestId(req.headers["x-request-id"]), module: "payment", event: "payment.autorenew.alipay.notify_failed",
        level: "error", status: "failed", errorCode: error instanceof Error ? error.message.split(":")[0] : "ALIPAY_NOTIFY_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error), metadata: { notifyId: fields.notify_id ?? null },
      });
      return reply.type("text/plain").status(500).send("fail");
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

    try {
      const current = await deps.autoRenewService.getCurrent(userContext.userId);
      const subscription = current.subscription?.provider === "alipay"
        ? await deps.alipayAutoRenewService.cancelAtPeriodEnd({ userId: userContext.userId, subscriptionId: req.body.autoRenewSubscriptionId.trim() })
        : await deps.autoRenewService.cancelWithProvider({ userId: userContext.userId, autoRenewSubscriptionId: req.body.autoRenewSubscriptionId.trim() });

      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.autorenew.cancel_scheduled",
        level: "info",
        status: "success",
        metadata: {
          autoRenewSubscriptionId: subscription.id,
          provider: subscription.provider,
          productCode: subscription.productCode,
          source: `${subscription.provider}_autorenew`,
          cancelAtPeriodEnd: readCancelAtPeriodEnd(subscription.metadata),
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        },
      });

      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          id: subscription.id,
          provider: subscription.provider,
          status: subscription.status,
          cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
          cancelAtPeriodEnd: readCancelAtPeriodEnd(subscription.metadata),
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

  app.post("/payment/autorenew/resume", async (req, reply) => {
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    if (!isResumeAutoRenewRequest(req.body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid auto renew resume payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;

    try {
      const result = await deps.alipayAutoRenewService.revertCancellation({
        userId: userContext.userId,
        subscriptionId: req.body.autoRenewSubscriptionId.trim(),
      });
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.autorenew.resume_requested",
        level: "info",
        status: "success",
        metadata: {
          autoRenewSubscriptionId: result.subscription.id,
          provider: result.subscription.provider,
          productCode: result.subscription.productCode,
          source: "alipay_autorenew",
        },
      });
      return reply.status(200).send({
        ok: true,
        request_id: requestId,
        data: {
          id: result.subscription.id,
          provider: result.subscription.provider,
          status: result.subscription.status,
          cancelAtPeriodEnd: readCancelAtPeriodEnd(result.subscription.metadata),
          jumpSchema: result.jumpSchema,
        },
      });
    } catch (error) {
      if (error instanceof AutoRenewNotFoundError || error instanceof AutoRenewAccessDeniedError) {
        return reply.status(404).send({
          ok: false,
          request_id: requestId,
          error: { code: "AUTO_RENEW_NOT_FOUND", message: CLIENT_ERROR_MESSAGES.AUTO_RENEW_NOT_FOUND },
        });
      }
      const message = error instanceof Error ? error.message : "Auto renew resume failed";
      const notAllowed = message === "ALIPAY_AUTORENEW_RESUME_NOT_ALLOWED";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.autorenew.resume_failed",
        level: notAllowed ? "warn" : "error",
        status: "failed",
        errorCode: notAllowed ? message : "AUTO_RENEW_RESUME_FAILED",
        errorMessage: message,
        metadata: { autoRenewSubscriptionId: req.body.autoRenewSubscriptionId.trim() },
      });
      return reply.status(notAllowed ? 409 : 502).send({
        ok: false,
        request_id: requestId,
        error: {
          code: notAllowed ? message : "AUTO_RENEW_RESUME_FAILED",
          message: notAllowed ? "Subscription can no longer be resumed" : "Auto renew resume failed",
        },
      });
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
      const data = await deps.appleIapService.verifyProMonthlyTransaction({
        userId: userContext.userId,
        transactionId: body.transactionId.trim(),
      });

      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "iOS IAP verify failed";
      if (error instanceof AutoRenewSwitchBlockedError) {
        // Apple 首次验单也要遵守同一条规则：取消旧渠道后，当前会员周期内不能马上换渠道重签。
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

  app.post("/payment/google-play/verify-purchase", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isGooglePlayVerifyPurchaseRequest(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.google_play.verify.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid Google Play verify payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;
    if (!config.payment.googlePlayBilling.enabled) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.google_play.verify.disabled",
        level: "warn",
        status: "failed",
        errorCode: "GOOGLE_PLAY_BILLING_DISABLED",
      });
      return reply.status(503).send({
        ok: false,
        request_id: requestId,
        error: { code: "GOOGLE_PLAY_BILLING_DISABLED", message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
      });
    }

    try {
      const data = await deps.googlePlayBillingService.verifySubscriptionPurchase({
        userId: userContext.userId,
        productId: body.productId.trim(),
        purchaseToken: body.purchaseToken.trim(),
        obfuscatedAccountId: body.obfuscatedAccountId?.trim() || null,
      });

      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Play IAP verify failed";
      if (error instanceof AutoRenewSwitchBlockedError) {
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
      if (error instanceof GooglePlaySubscriptionAlreadyBoundError) {
        return reply.status(409).send({
          ok: false,
          request_id: requestId,
          error: {
            code: error.code,
            message: CLIENT_ERROR_MESSAGES.GOOGLE_PLAY_SUBSCRIPTION_ALREADY_BOUND,
            purchaseToken: error.purchaseToken,
          },
        });
      }
      if (error instanceof GooglePlayBillingConfigError) {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId: userContext.userId,
          module: "payment",
          event: "payment.google_play.verify.not_configured",
          level: "warn",
          status: "failed",
          errorCode: error.code,
          errorMessage: message,
        });
        return reply.status(503).send({
          ok: false,
          request_id: requestId,
          error: { code: error.code, message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
        });
      }

      const verifyErrorCode =
        error instanceof GooglePlayBillingVerifyError
          ? error.code
          : "IAP_VERIFY_FAILED";
      const verifyErrorDetails =
        error instanceof GooglePlayBillingVerifyError
          ? error.details
          : null;
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.google_play.verify.failed",
        level: "warn",
        status: "failed",
        errorCode: verifyErrorCode,
        errorMessage: message,
        metadata: verifyErrorDetails
          ? { googlePlayVerify: verifyErrorDetails }
          : undefined,
      });
      return reply.status(verifyErrorCode === "GOOGLE_API_NETWORK_ERROR" ? 503 : 400).send({
        ok: false,
        request_id: requestId,
        error: { code: verifyErrorCode, message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
      });
    }
  });

  app.post("/payment/google-play/account-link", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isGooglePlayObfuscatedAccountIdRequest(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.google_play.account_link.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "VALIDATION_FAILED",
      });
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid Google Play account link payload" },
      });
    }

    const userContext = await resolvePaymentUserContext(req, reply, requestId, deps);
    if (!userContext) return;
    if (!config.payment.googlePlayBilling.enabled) {
      return reply.status(503).send({
        ok: false,
        request_id: requestId,
        error: { code: "GOOGLE_PLAY_BILLING_DISABLED", message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
      });
    }

    try {
      const data = await deps.googlePlayBillingService.registerObfuscatedAccountId({
        userId: userContext.userId,
        obfuscatedAccountId: body.obfuscatedAccountId.trim(),
      });
      return reply.status(200).send({ ok: true, request_id: requestId, data });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google Play account link registration failed";
      const errorCode =
        error instanceof GooglePlayBillingVerifyError
          ? error.code
          : error instanceof GooglePlaySubscriptionAlreadyBoundError
            ? error.code
            : "GOOGLE_PLAY_ACCOUNT_LINK_FAILED";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "payment",
        event: "payment.google_play.account_link.failed",
        level: "warn",
        status: "failed",
        errorCode,
        errorMessage: message,
      });
      return reply.status(error instanceof GooglePlayBillingVerifyError ? 400 : 409).send({
        ok: false,
        request_id: requestId,
        error: { code: errorCode, message: CLIENT_ERROR_MESSAGES.IAP_VERIFY_FAILED },
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

  app.post("/payment/google-play/notify", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
    const allowed = await checkPaymentRateLimit({
      req,
      reply,
      requestId,
      rule: {
        routeKey: "google_play_notify",
        path: "/payment/google-play/notify",
        limit: config.payment.rateLimitWebhookLimit,
        windowSec: config.payment.rateLimitWebhookWindowSec,
        responseType: "api",
      },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;
    if (!config.payment.googlePlayBilling.enabled) {
      return reply.status(503).send({
        ok: false,
        request_id: requestId,
        error: { code: "GOOGLE_PLAY_BILLING_DISABLED", message: CLIENT_ERROR_MESSAGES.IAP_NOTIFY_FAILED },
      });
    }
    const sharedTokenValid = isGooglePlayNotifyTokenValid(
      req,
      config.payment.googlePlayBilling.notifyToken
    );
    const oidcValid = await isGooglePlayNotifyOidcValid(req, {
      required: config.isProduction,
      audience: config.payment.googlePlayBilling.notifyOidcAudience,
      serviceAccountEmail: config.payment.googlePlayBilling.notifyOidcServiceAccountEmail,
    });
    if (!sharedTokenValid || !oidcValid) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "payment",
        event: "payment.google_play.notify.unauthorized",
        level: "warn",
        status: "failed",
        errorCode: "GOOGLE_PLAY_NOTIFY_UNAUTHORIZED",
      });
      return reply.status(401).send({
        ok: false,
        request_id: requestId,
        error: { code: "GOOGLE_PLAY_NOTIFY_UNAUTHORIZED", message: CLIENT_ERROR_MESSAGES.IAP_NOTIFY_FAILED },
      });
    }
    if (!isGooglePlayNotificationRequest(body)) {
      return reply.status(400).send({
        ok: false,
        request_id: requestId,
        error: { code: "VALIDATION_FAILED", message: "Invalid Google Play notify payload" },
      });
    }
    const messageId = typeof body.message?.messageId === "string" ? body.message.messageId : requestId;
    await deps.googlePlayBillingService.handleRealtimeDeveloperNotification({
      messageId,
      rawPayload: body,
    });
    return reply.status(200).send({ ok: true, request_id: requestId });
  });
}

async function getAlipayProductQuoteOrNull(
  app: FastifyInstance,
  deps: PaymentRouteDeps,
  productCode: "plus_monthly" | "pro_monthly",
) {
  try {
    return await deps.alipayAutoRenewService.getProductQuote(productCode);
  } catch (error) {
    app.log.warn(
      { error: error instanceof Error ? error.message : String(error), productCode },
      "Unable to load Alipay product price",
    );
    return null;
  }
}

function sanitizeAlipayErrorDetails(details: unknown): Record<string, string> | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const source = details as Record<string, unknown>;
  const allowedKeys = ["code", "msg", "sub_code", "sub_msg", "trace_id"] as const;
  const sanitized: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) sanitized[key] = value.trim().slice(0, 500);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isGooglePlayNotifyTokenValid(req: FastifyRequest, expectedToken: string | null): boolean {
  // Never expose a mutation-capable webhook without an authentication secret.
  if (!expectedToken) return false;
  const headerToken = firstHeaderValue(req.headers["x-google-play-notify-token"]);
  const query = req.query && typeof req.query === "object" ? (req.query as Record<string, unknown>) : {};
  const queryToken = typeof query.token === "string" ? query.token : null;
  return tokensEqual(headerToken, expectedToken) || tokensEqual(queryToken, expectedToken);
}

function readCancelAtPeriodEnd(metadata: unknown): boolean {
  return Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as Record<string, unknown>).cancelAtPeriodEnd === true);
}

function tokensEqual(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

let cachedGooglePlayNotifyOidc:
  | { token: string; audience: string; email: string; expiresAtMs: number }
  | null = null;

async function isGooglePlayNotifyOidcValid(
  req: FastifyRequest,
  input: {
    required: boolean;
    audience: string | null;
    serviceAccountEmail: string | null;
  }
): Promise<boolean> {
  if (!input.required && (!input.audience || !input.serviceAccountEmail)) return true;
  if (!input.audience || !input.serviceAccountEmail) return false;

  const authorization = firstHeaderValue(req.headers.authorization);
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return false;
  const now = Date.now();
  if (
    cachedGooglePlayNotifyOidc?.token === token &&
    cachedGooglePlayNotifyOidc.audience === input.audience &&
    cachedGooglePlayNotifyOidc.email === input.serviceAccountEmail &&
    cachedGooglePlayNotifyOidc.expiresAtMs > now + 30_000
  ) {
    return true;
  }

  try {
    const response = await fetchGoogleApi(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    );
    if (!response.ok) return false;
    const claims = (await response.json()) as Record<string, unknown>;
    const audience = typeof claims.aud === "string" ? claims.aud : "";
    const email = typeof claims.email === "string" ? claims.email : "";
    const emailVerified = claims.email_verified === true || claims.email_verified === "true";
    const expiresAtMs = Number(claims.exp) * 1000;
    if (
      audience !== input.audience ||
      email !== input.serviceAccountEmail ||
      !emailVerified ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= now
    ) {
      return false;
    }
    cachedGooglePlayNotifyOidc = {
      token,
      audience,
      email,
      expiresAtMs,
    };
    return true;
  } catch {
    return false;
  }
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
  routeKey: "ios_notify" | "google_play_notify" | "alipay_notify" | "alipay_create";
  path: "/payment/ios/notify" | "/payment/google-play/notify" | "/payment/autorenew/alipay/notify" | "/payment/autorenew/alipay/create";
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
