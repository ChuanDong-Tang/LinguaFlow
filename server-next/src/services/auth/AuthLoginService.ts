/** AuthLoginService：编排微信登录落库主链路（查身份、创建用户、绑定身份）。 */

import { createHmac } from "node:crypto";
import type { UserEntity, UserRepository } from "@lf/core/ports/repository/UserRepository";
import type { WeChatLoginResponse } from "@lf/core/contracts/auth";

export interface WeChatLoginInput {
  authingToken: string;
}

interface AuthingUserInfo {
  sub: string;
  nickname: string | null;
  picture: string | null;
}

export class AuthLoginService {
  constructor(private readonly userRepository: UserRepository) {}

  async loginWithWeChat(input: WeChatLoginInput): Promise<WeChatLoginResponse> {
    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    const providerUserId = authingUser.sub;
    const existing = await this.userRepository.findByAuthIdentity("wechat", providerUserId);

    if (existing) {
      return this.buildLoginResult(existing, false);
    }

    const createdUser = await this.userRepository.create({
      nickname: authingUser.nickname,
      avatarUrl: authingUser.picture,
    });

    await this.userRepository.bindAuthIdentity({
      userId: createdUser.id,
      provider: "wechat",
      providerUserId,
    });

    return this.buildLoginResult(createdUser, true);
  }

  private buildLoginResult(user: UserEntity, isNewUser: boolean): WeChatLoginResponse {
    return {
      accessToken: this.signAccessToken(user.id),
      user,
      isNewUser,
    };
  }

  private signAccessToken(userId: string): string {
    const secret = process.env.AUTH_JWT_SECRET ?? "dev-only-change-me";
    const header = this.base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = this.base64UrlEncode(
      JSON.stringify({
        sub: userId,
        iat: Math.floor(Date.now() / 1000),
      })
    );
    const unsignedToken = `${header}.${payload}`;
    const signature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");
    return `${unsignedToken}.${signature}`;
  }

  private base64UrlEncode(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
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
