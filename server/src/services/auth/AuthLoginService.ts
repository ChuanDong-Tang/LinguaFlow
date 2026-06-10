/** AuthLoginService：编排 Authing 登录落库主链路（查身份、创建用户、绑定身份、会话签发）。 */

import type { UserEntity, UserRepository } from "@lf/core/ports/repository/UserRepository.js";
import type { UserSessionRepository } from "@lf/core/ports/repository/UserSessionRepository.js";
import type { AuthingLoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import {
  signAccessTokenWithSession,
  signRefreshTokenWithSession,
  verifyRefreshToken,
} from "./JwtSessionToken.js";
import { createHash, randomUUID } from "node:crypto";

export interface AuthingLoginInput {
  authingToken: string;
}
export interface AuthingPasswordLoginInput {
  account: string;
  password: string;
}

export interface SessionContextInput {
  userAgent?: string | null;
  ip?: string | null;
}

interface AuthingUserInfo {
  sub: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  picture: string | null;
}

export class AuthLoginService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly userSessionRepository: UserSessionRepository
  ) {}

  async loginWithAuthing(
    input: AuthingLoginInput,
    sessionContext: SessionContextInput = {}
  ): Promise<AuthingLoginResponse> {
    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    const providerUserId = authingUser.sub;
    const result = await this.userRepository.findOrCreateByAuthIdentity({
      provider: "authing",
      providerUserId,
      nickname: authingUser.nickname,
      email: authingUser.email,
      phone: authingUser.phone,
      avatarUrl: authingUser.picture,
    });

    if (result.user.status !== "active") {
      throw new Error("Account is disabled");
    }

    return this.buildLoginResult(result.user, result.isNewUser, sessionContext);
  }

  async loginWithAuthingPassword(
    input: AuthingPasswordLoginInput,
    sessionContext: SessionContextInput = {}
  ): Promise<AuthingLoginResponse> {
    const authingToken = await this.resolveAuthingTokenByPassword(input);
    return this.loginWithAuthing({ authingToken }, sessionContext);
  }

  async refreshSession(
    input: { refreshToken: string },
    sessionContext: SessionContextInput = {}
  ): Promise<RefreshTokenResponse> {
    const payload = verifyRefreshToken(input.refreshToken);
    if (!payload) {
      throw new Error("Invalid refresh token");
    }

    if (!payload.sid) {
      throw new Error("Refresh token missing session id");
    }

    const currentSession = await this.userSessionRepository.findById(payload.sid);
    if (!currentSession) {
      throw new Error("Refresh session not found");
    }

    if (currentSession.revokedAt) {
      throw new Error("Refresh session revoked");
    }

    if (currentSession.expiresAt.getTime() <= Date.now()) {
      throw new Error("Refresh session expired");
    }

    if (currentSession.refreshTokenHash !== hashRefreshToken(input.refreshToken)) {
      throw new Error("Refresh token mismatch");
    }

    const user = await this.userRepository.findById(currentSession.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.status !== "active") {
      throw new Error("Account is disabled");
    }

    await this.userSessionRepository.update({
      id: currentSession.id,
      lastUsedAt: new Date(),
      userAgent: sessionContext.userAgent ?? currentSession.userAgent,
      ip: sessionContext.ip ?? currentSession.ip,
    });

    return {
      accessToken: signAccessTokenWithSession(user.id, currentSession.id),
      refreshToken: input.refreshToken,
    };
  }

  async createSessionTokens(
    input: { userId: string },
    sessionContext: SessionContextInput = {}
  ): Promise<RefreshTokenResponse> {
    return this.issueSessionTokens(input.userId, sessionContext);
  }

  async logout(input: { refreshToken: string }): Promise<void> {
    const payload = verifyRefreshToken(input.refreshToken);
    if (!payload?.sid) {
      throw new Error("Invalid refresh token");
    }

    const session = await this.userSessionRepository.findById(payload.sid);
    if (!session) {
      throw new Error("Refresh session not found");
    }

    if (session.refreshTokenHash !== hashRefreshToken(input.refreshToken)) {
      throw new Error("Refresh token mismatch");
    }

    if (!session.revokedAt) {
      await this.userSessionRepository.update({
        id: session.id,
        revokedAt: new Date(),
      });
    }
  }

  private async buildLoginResult(
    user: UserEntity,
    isNewUser: boolean,
    sessionContext: SessionContextInput
  ): Promise<AuthingLoginResponse> {
    const tokens = await this.issueSessionTokens(user.id, sessionContext);

    return {
      ...tokens,
      user,
      isNewUser,
    };
  }

  private async issueSessionTokens(
    userId: string,
    sessionContext: SessionContextInput
  ): Promise<RefreshTokenResponse> {
    const sessionId = randomUUID();
    const refreshToken = signRefreshTokenWithSession(userId, sessionId);
    const now = new Date();

    await this.userSessionRepository.create({
      id: sessionId,
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: sessionContext.userAgent ?? null,
      ip: sessionContext.ip ?? null,
      expiresAt: resolveRefreshExpiry(now),
    });

    return {
      accessToken: signAccessTokenWithSession(userId, sessionId),
      refreshToken,
    };
  }

  /**
   * 稍正式实现：通过 Authing OIDC 用户信息接口校验 token 并提取 sub。
   * 后续如果接入官方 SDK，可在此处替换，不影响上层流程。
   */
  private async resolveAuthingUserFromToken(authingToken: string): Promise<AuthingUserInfo> {
    const domain = getRuntimeConfig().authingDomain;
    if (!domain) {
      throw new Error("AUTHING_DOMAIN is required");
    }

    const normalizedDomain = domain.replace(/\/+$/, "");
    const endpoint = `${normalizedDomain}/oidc/me`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authingToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Authing token validation failed: ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) {
      throw new Error("Authing token payload missing sub");
    }

    return {
      sub,
      nickname: typeof payload.nickname === "string" ? payload.nickname : null,
      email: typeof payload.email === "string" ? payload.email : null,
      phone: getStringPayloadValue(payload, "phone_number") ?? getStringPayloadValue(payload, "phone"),
      picture: typeof payload.picture === "string" ? payload.picture : null,
    };
  }

  private async resolveAuthingTokenByPassword(input: AuthingPasswordLoginInput): Promise<string> {
    const config = getRuntimeConfig();
    const domain = config.authingDomain;
    const clientId = config.authingAppId;
    const clientSecret = config.authingAppSecret;
    if (!domain || !clientId || !clientSecret) {
      throw new Error("AUTHING_DOMAIN / AUTHING_APP_ID / AUTHING_APP_SECRET is required");
    }
    const normalizedDomain = domain.replace(/\/+$/, "");
    const endpoint = `${normalizedDomain}/oidc/token`;
    const account = input.account.trim();
    const form = new URLSearchParams({
      grant_type: "password",
      password: input.password,
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid profile",
    });
    if (isEmail(account)) {
      form.set("email", account);
    } else if (isPhone(account)) {
      form.set("phone", account);
    } else {
      form.set("username", account);
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof payload.error_description === "string"
          ? payload.error_description
          : typeof payload.error === "string"
            ? payload.error
            : `Authing password login failed: ${response.status}`;
      throw new Error(message);
    }
    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    if (!accessToken) {
      throw new Error("Authing password login missing access_token");
    }
    return accessToken;
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string): boolean {
  return /^\+?\d{6,20}$/.test(value);
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resolveRefreshExpiry(now: Date): Date {
  const ttlSeconds = getRuntimeConfig().authRefreshTokenTtlSeconds;
  return new Date(now.getTime() + ttlSeconds * 1000);
}
