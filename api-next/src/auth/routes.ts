import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthingLoginResponse, LoginCredential, LoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import { isAuthingLoginBody, isLoginRequest, isRefreshTokenBody } from "./validators.js";
import { isAllowedMockUserId, isMockAuthEnabled } from "./userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { resolveRequestId } from "../lib/httpResult.js";


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
  // 兼容旧登录接口（当前仍使用 MockAuthProvider）
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

    if (!isAuthingLoginBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.authing_login.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid authing login payload" },
      });
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
      return reply.status(isDisabled ? 403 : 401).send({
        ok: false,
        error: { code: isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID", message },
      });
    }

    return reply.status(200).send({
      ok: true,
      data: result,
    });
  });

  app.post("/auth/admin-password-login", async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);
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
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "account and password are required" },
      });
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
      return reply.status(isDisabled ? 403 : 401).send({
        ok: false,
        error: { code: isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID", message },
      });
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
      return reply.status(403).send({
        ok: false,
        error: { code: "ADMIN_FORBIDDEN", message: "Admin role is required" },
      });
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

    if (!isRefreshTokenBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.refresh.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid refresh token payload" },
      });
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
      return reply.status(isDisabled ? 403 : 401).send({
        ok: false,
        error: { code: isDisabled ? "ACCOUNT_DISABLED" : "AUTH_INVALID", message },
      });
    }
  });

  app.post("/auth/logout", async (req, reply) => {
    const body = req.body as unknown;
    const requestId = resolveRequestId(req.headers["x-request-id"]);
    reply.header("x-request-id", requestId);

    if (!isRefreshTokenBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        module: "auth",
        event: "auth.logout.invalid_payload",
        level: "warn",
        status: "failed",
        errorCode: "REQUEST_INVALID",
      });
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid logout payload" },
      });
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
      return reply.status(401).send({
        ok: false,
        error: { code: "AUTH_INVALID", message },
      });
    }
  });
}

function resolveSessionContext(req: FastifyRequest) {
  return {
    userAgent: firstHeaderValue(req.headers["user-agent"]),
    ip: resolveClientIp(firstHeaderValue(req.headers["x-forwarded-for"])),
  };
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveClientIp(forwardedFor: string | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}
