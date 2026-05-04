/** AuthLoginService：编排 Authing 登录落库主链路（查身份、创建用户、绑定身份）。 */

import type { UserEntity, UserRepository } from "@lf/core/ports/repository/UserRepository.js";
import type { AuthingLoginResponse, RefreshTokenResponse } from "@lf/core/contracts/auth.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./JwtSessionToken.js";

export interface AuthingLoginInput {
  authingToken: string;
}

interface AuthingUserInfo {
  sub: string;
  nickname: string | null;
  picture: string | null;
}

export class AuthLoginService {
  constructor(private readonly userRepository: UserRepository) {}

  async loginWithAuthing(input: AuthingLoginInput): Promise<AuthingLoginResponse> {
    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    const providerUserId = authingUser.sub;
    const existing = await this.userRepository.findByAuthIdentity("authing", providerUserId);

    if (existing) {
      return this.buildLoginResult(existing, false);
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

    return this.buildLoginResult(createdUser, true);
  }

  refreshSession(input: { refreshToken: string }): RefreshTokenResponse {
    const payload = verifyRefreshToken(input.refreshToken);
    if (!payload) {
      throw new Error("Invalid refresh token");
    }

    return {
      accessToken: signAccessToken(payload.sub),
      refreshToken: signRefreshToken(payload.sub),
    };
  }

  private buildLoginResult(user: UserEntity, isNewUser: boolean): AuthingLoginResponse {
    return {
      accessToken: signAccessToken(user.id),
      refreshToken: signRefreshToken(user.id),
      user,
      isNewUser,
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
