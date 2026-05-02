import type { FastifyInstance } from "fastify";
import type { LoginCredential, LoginResponse, WeChatLoginResponse } from "@lf/core/contracts/auth";
import { isLoginRequest, isWeChatLoginBody } from "./validators";
import { isMockUserId } from "./mockUser";


export interface AuthRouteDeps {
  authProvider: {
    login: (credential: LoginCredential) => Promise<LoginResponse>;
  };
  authLoginService: {
    loginWithWeChat: (input: {
      authingToken: string;
    }) => Promise<WeChatLoginResponse>;
  };

  userRepository: {
    ensureUserExists: (input: {
      id: string;
      nickname?: string | null;
      avatarUrl?: string | null;
      status?: "active" | "disabled";
    }) => Promise<void>;
  };
}

/** 注册认证相关路由 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  // 兼容旧登录接口（当前仍使用 MockAuthProvider）
  app.post("/auth/login", async (req, reply) => {
    const body = req.body as unknown;

    if (!isLoginRequest(body)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid login payload" },
      });
    }

    const data = await deps.authProvider.login(body);

    if (isMockUserId(data.user.id)) {
      await deps.userRepository.ensureUserExists({
        id: data.user.id,
        nickname: data.user.displayName ?? "Mock User",
        avatarUrl: data.user.avatarUrl ?? null,
        status: "active",
      });
    }

    return reply.status(200).send({
      ok: true,
      data,
    });
  });

  // 微信登录（落库版）：查身份 -> 无则创建用户并绑定身份
  app.post("/auth/wechat-login", async (req, reply) => {
    const body = req.body as unknown;

    if (!isWeChatLoginBody(body)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "REQUEST_INVALID", message: "Invalid wechat login payload" },
      });
    }

    let result: WeChatLoginResponse;
    try {
      result = await deps.authLoginService.loginWithWeChat({
        authingToken: body.authingToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized";
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
}
