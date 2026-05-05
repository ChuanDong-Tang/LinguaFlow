/** AuthLoginService：编排 Authing 登录落库主链路（查身份、创建用户、绑定身份、会话签发）。 */

import type { UserEntity, UserRepository } from "@lf/core/ports/repository/UserRepository.js";
import type { UserSessionRepository } from "@lf/core/ports/repository/UserSessionRepository.js";
import type { AuthingLoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import {
  signAccessTokenWithSession,
  signRefreshTokenWithSession,
  verifyRefreshToken,
} from "./JwtSessionToken.js";
import { createHash, randomUUID } from "node:crypto";

export interface AuthingLoginInput {
  authingToken: string;
}

export interface SessionContextInput {
  userAgent?: string | null;
  ip?: string | null;
}

interface AuthingUserInfo {
  sub: string;
  nickname: string | null;
  picture: string | null;
}

const DEFAULT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

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
    const existing = await this.userRepository.findByAuthIdentity("authing", providerUserId);

    if (existing) {
      if (existing.status !== "active") {
        throw new Error("Account is disabled");
      }
      return this.buildLoginResult(existing, false, sessionContext);
    }

    const createdUser = await this.userRepository.create({
      nickname: authingUser.nickname,
      avatarUrl: authingUser.picture,
    });

    await this.userRepository.bindAuthIdentity({
      userId: createdUser.id,
      provider: "authing",
      providerUserId,
    });

    return this.buildLoginResult(createdUser, true, sessionContext);
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

    const now = new Date();
    const nextSessionId = randomUUID();
    const nextRefreshToken = signRefreshTokenWithSession(user.id, nextSessionId);
    await this.userSessionRepository.update({
      id: currentSession.id,
      revokedAt: now,
      replacedBySessionId: nextSessionId,
      lastUsedAt: now,
    });
    await this.userSessionRepository.create({
      id: nextSessionId,
      userId: user.id,
      refreshTokenHash: hashRefreshToken(nextRefreshToken),
      userAgent: sessionContext.userAgent ?? currentSession.userAgent,
      ip: sessionContext.ip ?? currentSession.ip,
      expiresAt: resolveRefreshExpiry(now),
    });

    return {
      accessToken: signAccessTokenWithSession(user.id, nextSessionId),
      refreshToken: nextRefreshToken,
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
    const domain = process.env.AUTHING_DOMAIN?.trim();
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
      picture: typeof payload.picture === "string" ? payload.picture : null,
    };
  }
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resolveRefreshExpiry(now: Date): Date {
  const ttlSeconds = getRefreshTokenTtlSeconds();
  return new Date(now.getTime() + ttlSeconds * 1000);
}

function getRefreshTokenTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_TTL_SECONDS;
}
