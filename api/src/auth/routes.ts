import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AuthingLoginResponse, LoginCredential, LoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import { isAuthingLoginBody, isLoginRequest, isRefreshTokenBody } from "./validators.js";
import { isAllowedMockUserId, isMockAuthEnabled } from "./userContext.js";
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

  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled";
      role: "user" | "admin";
    } | null>;
    ensureUserExists: (input: {
      id: string;
      nickname?: string | null;
      avatarUrl?: string | null;
      status?: "active" | "disabled";
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
      const isDisabled = message === "Account is disabled";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.authing_login.failed",
        level: "warn",
        status: "failed",
        errorCode: isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID",
        errorMessage: message,
      });
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
          avatarUrl: null,
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
      const isDisabled = message === "Account is disabled";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.admin_password_login.authing_failed",
        level: "warn",
        status: "failed",
        errorCode: isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID",
        errorMessage: message,
        metadata: { account },
      });
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
      const isDisabled = message === "Account is disabled";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.refresh.failed",
        level: "warn",
        status: "failed",
        errorCode: isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID",
        errorMessage: message,
      });
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
  routeKey: "authing_login" | "test_password_login" | "admin_password_login" | "refresh" | "logout";
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
