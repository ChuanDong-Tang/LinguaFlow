import type { FastifyInstance } from "fastify";
import type { AuthingLoginResponse, LoginCredential, LoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import { isAuthingLoginBody, isLoginRequest, isRefreshTokenBody } from "./validators.js";
import { isAllowedMockUserId, isMockAuthEnabled } from "./userContext.js";
import { signAccessToken, signRefreshToken } from "@lf/server-next/services/auth/JwtSessionToken.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";


export interface AuthRouteDeps {
  authProvider: {
    login: (credential: LoginCredential) => Promise<LoginResponse>;
  };
  authLoginService: {
    loginWithAuthing: (input: {
      authingToken: string;
    }) => Promise<AuthingLoginResponse>;
    refreshSession: (input: { refreshToken: string }) => RefreshTokenResponse;
  };

  userRepository: {
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

    if (!isMockAuthEnabled()) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
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
      await deps.userRepository.ensureUserExists({
        id: data.user.id,
        nickname: data.user.displayName ?? "Mock User",
        avatarUrl: data.user.avatarUrl ?? null,
        status: "active",
      });
    }

    const accessToken = signAccessToken(data.user.id);
    const refreshToken = signRefreshToken(data.user.id);

    return reply.status(200).send({
      ok: true,
      data: {
        ...data,
        token: accessToken,
        refreshToken,
      },
    });
  });

  // Authing 登录（落库版）：查身份 -> 无则创建用户并绑定身份
  app.post("/auth/authing-login", async (req, reply) => {
    const body = req.body as unknown;

    if (!isAuthingLoginBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
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
      result = await deps.authLoginService.loginWithAuthing({
        authingToken: body.authingToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        module: "auth",
        event: "auth.authing_login.failed",
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

    return reply.status(200).send({
      ok: true,
      data: result,
    });
  });

  app.post("/auth/refresh", async (req, reply) => {
    const body = req.body as unknown;

    if (!isRefreshTokenBody(body)) {
      await writeSystemEventLog(deps.systemEventLogRepository, {
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
      const result = deps.authLoginService.refreshSession({
        refreshToken: body.refreshToken,
      });
      return reply.status(200).send({
        ok: true,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
      await writeSystemEventLog(deps.systemEventLogRepository, {
        module: "auth",
        event: "auth.refresh.failed",
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
