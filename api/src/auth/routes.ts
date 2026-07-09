import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AuthingLoginResponse, LoginCredential, LoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import {
  isAuthingLoginBody,
  isConfirmBindEmailBody,
  isConfirmDeleteAccountBody,
  isLoginRequest,
  isPrepareBindEmailBody,
  isPrepareDeleteAccountBody,
  isRefreshTokenBody,
} from "./validators.js";
import {
  isAllowedMockUserId,
  isMockAuthEnabled,
  resolveActiveUserContext,
  AccountDisabledError,
  AccountPendingDeleteError,
  UnauthorizedError,
} from "./userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { resolveRequestId } from "../lib/httpResult.js";
import {
  checkIpPathRateLimit,
  firstHeaderValue,
  resolveClientIp as resolveClientIpFromRequest,
} from "../lib/rateLimit.js";

export interface AuthRouteDeps {
  authProvider: {
    login: (credential: LoginCredential) => Promise<LoginResponse>;
  };
  authLoginService: {
    loginWithAuthing: (input: {
      authingToken: string;
    }, sessionContext?: {
      userAgent?: string | null;
      ip?: string | null;
    }) => Promise<AuthingLoginResponse>;
    loginWithAuthingPassword: (input: {
      account: string;
      password: string;
    }, sessionContext?: {
      userAgent?: string | null;
      ip?: string | null;
    }) => Promise<AuthingLoginResponse>;
    createSessionTokens: (input: { userId: string }, sessionContext?: {
      userAgent?: string | null;
      ip?: string | null;
    }) => Promise<RefreshTokenResponse>;
    refreshSession: (input: { refreshToken: string }, sessionContext?: {
      userAgent?: string | null;
      ip?: string | null;
    }) => Promise<RefreshTokenResponse>;
    logout: (input: { refreshToken: string }) => Promise<void>;
  };
  accountDeletionService: {
    prepare: (input: {
      userId: string;
      authingToken: string;
    }) => Promise<{
      authingToken: string;
      method: "PHONE_PASSCODE" | "EMAIL_PASSCODE";
      target: string;
    }>;
    confirm: (input: {
      userId: string;
      authingToken: string;
      method: "PHONE_PASSCODE" | "EMAIL_PASSCODE";
      passCode: string;
    }) => Promise<{ success: true }>;
  };
  accountEmailBindingService: {
    prepare: (input: {
      userId: string;
      authingToken: string;
      email: string;
    }) => Promise<{
      authingToken: string;
      email: string;
      target: string;
    }>;
    confirm: (input: {
      userId: string;
      authingToken: string;
      email: string;
      passCode: string;
    }) => Promise<{
      id: string;
      nickname: string | null;
      email: string | null;
      phone: string | null;
      avatarUrl: string | null;
      status: "active" | "disabled" | "pending_delete";
      role: "user" | "admin";
      createdAt: Date;
      updatedAt: Date;
    }>;
  };

  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
      role: "user" | "admin";
    } | null>;
    ensureUserExists: (input: {
      id: string;
      nickname?: string | null;
      avatarUrl?: string | null;
      status?: "active" | "disabled" | "pending_delete";
    }) => Promise<void>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
}

/** 注册认证相关路由 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  // 开发调试专用 Mock 登录入口：生产环境必须禁用（LF_ALLOW_MOCK_AUTH=false）
  app.post("/auth/login", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isMockAuthEnabled()) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.mock_login.disabled",
        level: "warn",
        status: "failed",
        errorCode: "MOCK_AUTH_DISABLED",
      });
      return reply.status(403).send({
        ok: false,
        error: { code: "MOCK_AUTH_DISABLED", message: "Mock auth is disabled" },
      });
    }

    if (!isLoginRequest(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.mock_login.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid login payload" },
      });
    }

    const data = await deps.authProvider.login(body);

    if (isAllowedMockUserId(data.user.id)) {
      const existing = await deps.userRepository.findById(data.user.id);
      if (existing?.status === "pending_delete") {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          module: "auth",
          event: "auth.mock_login.pending_delete_account",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_PENDING_DELETE",
          userId: data.user.id,
        });
        return sendAccountPendingDeleteError(reply);
      }

      if (existing?.status === "disabled") {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          module: "auth",
          event: "auth.mock_login.disabled_account",
          level: "warn",
          status: "failed",
          errorCode: "ACCOUNT_DISABLED",
          userId: data.user.id,
        });
        return reply.status(403).send({
          ok: false,
          error: { code: "ACCOUNT_DISABLED", message: "Account is disabled" },
        });
      }

      if (!existing) {
        await deps.userRepository.ensureUserExists({
          id: data.user.id,
          nickname: data.user.displayName ?? "Mock User",
          avatarUrl: data.user.avatarUrl ?? null,
          status: "active",
        });
      }
    }

    const tokens = await deps.authLoginService.createSessionTokens(
      { userId: data.user.id },
      resolveSessionContext(req)
    );

    return reply.status(200).send({
      ok: true,
      data: {
        ...data,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  });

  // Authing 登录（落库版）：查身份 -> 无则创建用户并绑定身份
  app.post("/auth/authing-login", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "authing_login", limit: 20, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isAuthingLoginBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.authing_login.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return sendAuthGenericError(reply);
    }

    let result: AuthingLoginResponse;
    try {
      result = await deps.authLoginService.loginWithAuthing(
        {
          authingToken: body.authingToken,
        },
        resolveSessionContext(req)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      const isPendingDelete = message === "Account deletion is in progress";
      const isDisabled = message === "Account is disabled";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.authing_login.failed",
        level: "warn",
        status: "failed",
        errorCode: isPendingDelete ? "ACCOUNT_PENDING_DELETE" : isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID",
        errorMessage: message,
      });
      if (isPendingDelete) return sendAccountPendingDeleteError(reply);
      if (isDisabled) return sendAccountDisabledError(reply);
      return sendAuthGenericError(reply);
    }

    return reply.status(200).send({
      ok: true,
      data: result,
    });
  });

  app.post("/auth/test-password-login", async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isMockAuthEnabled()) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.test_password_login.disabled",
        level: "warn",
        status: "failed",
        errorCode: "MOCK_AUTH_DISABLED",
      });
      return reply.status(403).send({
        ok: false,
        error: { code: "MOCK_AUTH_DISABLED", message: "Mock auth is disabled" },
      });
    }

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "test_password_login", limit: 10, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    const account = typeof body?.account === "string" ? body.account.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const testUserId = resolveTestPasswordLoginUserId(account);
    if (!testUserId || password !== "123456") {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.test_password_login.failed",
        level: "warn",
        status: "failed",
        errorCode: "AUTH_INVALID",
        metadata: { account },
      });
      return sendAuthGenericError(reply);
    }

    const existing = await deps.userRepository.findById(testUserId);
    if (existing?.status === "pending_delete") {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.test_password_login.pending_delete_account",
        level: "warn",
        status: "failed",
        errorCode: "ACCOUNT_PENDING_DELETE",
        userId: testUserId,
      });
      return sendAccountPendingDeleteError(reply);
    }

    if (existing?.status === "disabled") {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.test_password_login.disabled_account",
        level: "warn",
        status: "failed",
        errorCode: "ACCOUNT_DISABLED",
        userId: testUserId,
      });
      return reply.status(403).send({
        ok: false,
        error: { code: "ACCOUNT_DISABLED", message: "Account is disabled" },
      });
    }

    if (!existing) {
      await deps.userRepository.ensureUserExists({
        id: testUserId,
        nickname: account,
        avatarUrl: null,
        status: "active",
      });
    }

    const tokens = await deps.authLoginService.createSessionTokens(
      { userId: testUserId },
      resolveSessionContext(req)
    );

    return reply.status(200).send({
      ok: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: testUserId,
          nickname: account,
          email: null,
          phone: null,
          avatarUrl: null,
          role: existing?.role ?? "user",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        isNewUser: !existing,
      },
    });
  });

  app.post("/auth/admin-password-login", async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "admin_password_login", limit: 5, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    const account = typeof body?.account === "string" ? body.account.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!account || !password) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.admin_password_login.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return sendAuthGenericError(reply);
    }

    let result: AuthingLoginResponse;
    try {
      result = await deps.authLoginService.loginWithAuthingPassword(
        { account, password },
        resolveSessionContext(req)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      const isPendingDelete = message === "Account deletion is in progress";
      const isDisabled = message === "Account is disabled";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.admin_password_login.authing_failed",
        level: "warn",
        status: "failed",
        errorCode: isPendingDelete ? "ACCOUNT_PENDING_DELETE" : isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID",
        errorMessage: message,
        metadata: { account },
      });
      if (isPendingDelete) return sendAccountPendingDeleteError(reply);
      if (isDisabled) return sendAccountDisabledError(reply);
      return sendAuthGenericError(reply);
    }

    const user = await deps.userRepository.findById(result.user.id);
    if (!user || user.role !== "admin" || user.status !== "active") {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.admin_password_login.role_denied",
        level: "warn",
        status: "failed",
        errorCode: "ADMIN_FORBIDDEN",
        userId: result.user.id,
      });
      return sendAuthGenericError(reply);
    }

    return reply.status(200).send({
      ok: true,
      data: result,
    });
  });

  app.post("/auth/refresh", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "refresh", limit: 60, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isRefreshTokenBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.refresh.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return sendAuthGenericError(reply);
    }

    try {
      const result = await deps.authLoginService.refreshSession(
        {
          refreshToken: body.refreshToken,
        },
        resolveSessionContext(req)
      );
      return reply.status(200).send({
        ok: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      const isPendingDelete = message === "Account deletion is in progress";
      const isDisabled = message === "Account is disabled";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.refresh.failed",
        level: "warn",
        status: "failed",
        errorCode: isPendingDelete ? "ACCOUNT_PENDING_DELETE" : isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID",
        errorMessage: message,
      });
      if (isPendingDelete) return sendAccountPendingDeleteError(reply);
      if (isDisabled) return sendAccountDisabledError(reply);
      return sendAuthGenericError(reply);
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "logout", limit: 120, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isRefreshTokenBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.logout.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return sendAuthGenericError(reply);
    }

    try {
      await deps.authLoginService.logout({ refreshToken: body.refreshToken });
      return reply.status(200).send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Logout failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.logout.failed",
        level: "warn",
        status: "failed",
        errorCode: "AUTH_INVALID",
        errorMessage: message,
      });
      return sendAuthGenericError(reply);
    }
  });

  app.post("/auth/delete-account/prepare", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "delete_account", limit: 5, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isPrepareDeleteAccountBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.delete_account.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid delete account payload" },
      });
    }

    const userContext = await resolveDeleteAccountUserContext(req, reply, deps, requestId);
    if (!userContext) return;

    try {
      const data = await deps.accountDeletionService.prepare({
        userId: userContext.userId,
        authingToken: body.authingToken,
      });
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.delete_account.prepare_success",
        level: "info",
        status: "success",
        metadata: { method: data.method },
      });
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Prepare delete account failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.delete_account.prepare_failed",
        level: "warn",
        status: "failed",
        errorCode: "DELETE_ACCOUNT_PREPARE_FAILED",
        errorMessage: message,
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "DELETE_ACCOUNT_FAILED", message: "Delete account failed" },
      });
    }
  });

  app.post("/auth/delete-account/confirm", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "delete_account", limit: 8, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isConfirmDeleteAccountBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.delete_account.confirm_invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid delete account payload" },
      });
    }

    const userContext = await resolveDeleteAccountUserContext(req, reply, deps, requestId);
    if (!userContext) return;

    try {
      const data = await deps.accountDeletionService.confirm({
        userId: userContext.userId,
        authingToken: body.authingToken,
        method: body.method,
        passCode: body.passCode,
      });
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.delete_account.success",
        level: "info",
        status: "success",
      });
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete account failed";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.delete_account.failed",
        level: "warn",
        status: "failed",
        errorCode: "DELETE_ACCOUNT_FAILED",
        errorMessage: message,
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "DELETE_ACCOUNT_FAILED", message: "Delete account failed" },
      });
    }
  });

  app.post("/auth/bind-email/prepare", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "bind_email", limit: 5, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isPrepareBindEmailBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.bind_email.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid bind email payload" },
      });
    }

    const userContext = await resolveDeleteAccountUserContext(req, reply, deps, requestId);
    if (!userContext) return;

    try {
      const data = await deps.accountEmailBindingService.prepare({
        userId: userContext.userId,
        authingToken: body.authingToken,
        email: body.email,
      });
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.bind_email.prepare_success",
        level: "info",
        status: "success",
        metadata: { target: data.target },
      });
      return reply.status(200).send({ ok: true, data });
    } catch (error) {
      const mapped = mapBindEmailError(error);
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.bind_email.prepare_failed",
        level: "warn",
        status: "failed",
        errorCode: mapped.code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return reply.status(mapped.status).send({
        ok: false,
        error: { code: mapped.code, message: mapped.message },
      });
    }
  });

  app.post("/auth/bind-email/confirm", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    const allowed = await checkAuthRateLimit({
      req,
      reply,
      requestId,
      rule: { routeKey: "bind_email", limit: 8, windowSec: 60 },
      systemEventLogRepository: deps.systemEventLogRepository,
    });
    if (!allowed) return;

    if (!isConfirmBindEmailBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.bind_email.confirm_invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid bind email payload" },
      });
    }

    const userContext = await resolveDeleteAccountUserContext(req, reply, deps, requestId);
    if (!userContext) return;

    try {
      const user = await deps.accountEmailBindingService.confirm({
        userId: userContext.userId,
        authingToken: body.authingToken,
        email: body.email,
        passCode: body.passCode,
      });
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.bind_email.success",
        level: "info",
        status: "success",
      });
      return reply.status(200).send({ ok: true, data: { user } });
    } catch (error) {
      const mapped = mapBindEmailError(error);
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId: userContext.userId,
        module: "auth",
        event: "auth.bind_email.failed",
        level: "warn",
        status: "failed",
        errorCode: mapped.code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return reply.status(mapped.status).send({
        ok: false,
        error: { code: mapped.code, message: mapped.message },
      });
    }
  });
}

async function resolveDeleteAccountUserContext(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: AuthRouteDeps,
  _requestId: string
) {
  try {
    return await resolveActiveUserContext({
      authorization: req.headers.authorization,
      userRepository: deps.userRepository,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await reply.status(401).send({
        ok: false,
        error: { code: error.code, message: error.message },
      });
      return null;
    }
    if (error instanceof AccountDisabledError) {
      await sendAccountDisabledError(reply);
      return null;
    }
    if (error instanceof AccountPendingDeleteError) {
      await sendAccountPendingDeleteError(reply);
      return null;
    }
    throw error;
  }
}

function resolveSessionContext(req: FastifyRequest) {
  return {
    userAgent: firstHeaderValue(req.headers["user-agent"]),
    ip: resolveClientIpFromRequest(req),
  };
}

function resolveTestPasswordLoginUserId(account: string): string | null {
  const match = /^User(0[1-9]|10)$/.exec(account);
  if (!match) return null;
  return `mock_user_${match[1].padStart(3, "0")}`;
}

// redis限流
type AuthRateLimitRule = {
  routeKey:
    | "authing_login"
    | "test_password_login"
    | "admin_password_login"
    | "refresh"
    | "logout"
    | "delete_account"
    | "bind_email";
  limit: number;
  windowSec: number;
};

//ip限流
async function checkAuthRateLimit(input: {
  req: FastifyRequest;
  reply: FastifyReply;
  requestId: string;
  rule: AuthRateLimitRule;
  systemEventLogRepository?: SystemEventLogWriter;
}): Promise<boolean> {
  return checkIpPathRateLimit({
    req: input.req,
    reply: input.reply,
    requestId: input.requestId,
    systemEventLogRepository: input.systemEventLogRepository,
    module: "auth",
    routeKey: input.rule.routeKey,
    path: input.req.url,
    limit: input.rule.limit,
    windowSec: input.rule.windowSec,
    keyPrefix: "rl:auth",
    exceededEvent: "auth.rate_limit.exceeded",
    redisUnavailableEvent: "auth.rate_limit.redis_unavailable",
    onExceeded: async () => {
      await input.reply.status(429).send({
        ok: false,
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      });
    },
  });
}

// 对外不展示报错细节
function sendAuthGenericError(reply: FastifyReply) {
  return reply.status(401).send({
    ok: false,
    error: { code: "AUTH_INVALID", message: "Authentication failed" },
  });
}

function sendAccountDisabledError(reply: FastifyReply) {
  return reply.status(403).send({
    ok: false,
    error: { code: "ACCOUNT_DISABLED", message: "Account is disabled" },
  });
}

function sendAccountPendingDeleteError(reply: FastifyReply) {
  return reply.status(403).send({
    ok: false,
    error: { code: "ACCOUNT_PENDING_DELETE", message: "账号正在注销流程中，暂时无法登录" },
  });
}

function mapBindEmailError(error: unknown): { status: number; code: string; message: string } {
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  if (code === "EMAIL_TAKEN") {
    return { status: 409, code: "EMAIL_TAKEN", message: "该邮箱已绑定其他账号，请更换邮箱或使用该邮箱账号登录" };
  }
  if (code === "EMAIL_ALREADY_BOUND") {
    return { status: 409, code: "EMAIL_ALREADY_BOUND", message: "当前账号已绑定邮箱" };
  }
  if (error instanceof Error && error.message === "Invalid email") {
    return { status: 400, code: "INVALID_EMAIL", message: "邮箱格式不正确" };
  }
  if (
    error instanceof Error &&
    (error.message.startsWith("Authing token validation failed") ||
      error.message === "Authing account does not match current user")
  ) {
    return { status: 401, code: "AUTHING_REAUTH_REQUIRED", message: "请重新验证身份后绑定邮箱" };
  }
  return { status: 400, code: "BIND_EMAIL_FAILED", message: "绑定邮箱失败，请稍后重试" };
}
