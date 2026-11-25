/** AuthLoginService：编排 Authing 登录落库主链路（查身份、创建用户、绑定身份、会话签发）。 */

import type { UserEntity, UserRepository } from "@lf/core/ports/repository/UserRepository.js";
import type { UserSessionRepository } from "@lf/core/ports/repository/UserSessionRepository.js";
import type {
  AuthingLoginResponse,
  AuthingPasscodeChannel,
  AuthingPasscodeLoginResponse,
  AuthingPasswordLoginResponse,
  RefreshTokenResponse,
} from "@lf/core/contracts/auth.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import { AuthenticationClient, Models } from "authing-node-sdk";
import {
  signAccessTokenWithSession,
  signAccountToken,
  signRefreshTokenWithSession,
  verifyRefreshToken,
} from "./JwtSessionToken.js";
import { createHash, randomUUID } from "node:crypto";
import type { PasscodeProvider, PasscodeProviderResolver, VerificationChannel } from "@lf/core/ports/repository/AuthVerificationCodeRepository.js";
import type { VerificationCodeService } from "./VerificationCodeService.js";
import { InvalidContactError, normalizeCnPhone, normalizeEmailAddress } from "./contactNormalization.js";
import { hashPassword, verifyPassword } from "./PasswordHasher.js";

export interface AuthingLoginInput {
  authingToken: string;
}
export interface AuthingPasswordLoginInput {
  account: string;
  password: string;
}

export interface AuthingPasscodeInput {
  channel: AuthingPasscodeChannel;
  phone?: string;
  phoneCountryCode?: string;
  email?: string;
}

export interface AuthingPasscodeLoginInput extends AuthingPasscodeInput {
  passCode: string;
}

export interface SessionContextInput {
  userAgent?: string | null;
  ip?: string | null;
}

export interface AuthingUserInfo {
  sub: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  picture: string | null;
}

/** Authing calls, injectable so the lazy password migration can be tested. */
export interface AuthingIdentityGateway {
  passwordToken(input: AuthingPasswordLoginInput): Promise<string>;
  userInfo(authingToken: string): Promise<AuthingUserInfo>;
}

export interface AuthLoginServiceOptions {
  /** Self-hosted codes; required when passcodeProvider() is "local". */
  verificationCodes?: VerificationCodeService;
  /** Per channel, so email can move off Authing before SMS (or vice versa). */
  passcodeProvider?: PasscodeProviderResolver;
  /** Whether a password without a local hash may still be checked by Authing. */
  authingPasswordFallback?: () => boolean;
  authing?: AuthingIdentityGateway;
  /** Logged, never thrown: a failed hash capture must not fail the login. */
  onPasswordCaptureFailed?: (error: unknown) => void;
}

export class PasswordLoginError extends Error {
  constructor(readonly reason: "PASSWORD_MISMATCH" | "PASSWORD_NOT_SET" | "ACCOUNT_NOT_FOUND") {
    super(`Password login failed: ${reason}`);
  }
}

export class AuthLoginService {
  private readonly authing: AuthingIdentityGateway;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly userSessionRepository: UserSessionRepository,
    private readonly options: AuthLoginServiceOptions = {},
  ) {
    this.authing = options.authing ?? {
      passwordToken: (input) => this.resolveAuthingTokenByPassword(input),
      userInfo: (token) => this.resolveAuthingUserFromToken(token),
    };
  }

  private passcodeProvider(channel: VerificationChannel): PasscodeProvider {
    return this.options.passcodeProvider?.(channel) ?? "authing";
  }

  private requireVerificationCodes(): VerificationCodeService {
    if (!this.options.verificationCodes) throw new Error("Self-hosted verification codes are not configured");
    return this.options.verificationCodes;
  }

  async loginWithAuthing(
    input: AuthingLoginInput,
    sessionContext: SessionContextInput = {}
  ): Promise<AuthingLoginResponse> {
    const authingUser = await this.authing.userInfo(input.authingToken);
    const providerUserId = authingUser.sub;
    const result = await this.userRepository.findOrCreateByAuthIdentity({
      provider: "authing",
      providerUserId,
      nickname: authingUser.nickname,
      email: authingUser.email,
      phone: authingUser.phone,
      avatarUrl: authingUser.picture,
    });

    if (result.user.status === "pending_delete") {
      throw new Error("Account deletion is in progress");
    }

    if (result.user.status !== "active") {
      throw new Error("Account is disabled");
    }

    return this.buildLoginResult(result.user, result.isNewUser, sessionContext);
  }

  /**
   * Local hash first. Without one, Authing checks the password once (while it
   * is still available) and the hash is kept, so the account no longer needs
   * Authing afterwards.
   */
  async loginWithAuthingPassword(
    input: AuthingPasswordLoginInput,
    sessionContext: SessionContextInput = {}
  ): Promise<AuthingPasswordLoginResponse> {
    const localUser = await this.findUserByAccount(input.account);
    const localHash = localUser ? await this.userRepository.getPasswordHash(localUser.id) : null;
    if (localUser && localHash) {
      if (!await verifyPassword(input.password, localHash)) throw new PasswordLoginError("PASSWORD_MISMATCH");
      assertUserCanLogin(localUser);
      const result = await this.buildLoginResult(localUser, false, sessionContext);
      return { ...result, authingToken: signAccountToken(localUser.id) };
    }
    if (!(this.options.authingPasswordFallback?.() ?? true)) {
      throw new PasswordLoginError(localUser ? "PASSWORD_NOT_SET" : "ACCOUNT_NOT_FOUND");
    }
    const authingToken = await this.authing.passwordToken(input);
    const result = await this.loginWithAuthing({ authingToken }, sessionContext);
    try {
      await this.userRepository.setPasswordHash(result.user.id, await hashPassword(input.password));
    } catch (error) {
      this.options.onPasswordCaptureFailed?.(error);
    }
    return { ...result, authingToken };
  }

  async sendAuthingPasscode(input: AuthingPasscodeInput, context: { requestIp?: string | null } = {}): Promise<void> {
    if (this.passcodeProvider(input.channel) === "local") {
      const target = normalizePasscodeTarget(input);
      await this.requireVerificationCodes().issue({ channel: input.channel, target, purpose: "login", requestIp: context.requestIp ?? null });
      return;
    }
    const client = this.createAuthingClient();
    const response = input.channel === "phone"
      ? await client.sendSms({
          channel: Models.SendSMSDto.channel.CHANNEL_LOGIN,
          phoneNumber: requireAuthingValue(input.phone, "Phone is required"),
          phoneCountryCode: input.phoneCountryCode ?? "+86",
        })
      : await client.sendEmail({
          channel: Models.SendEmailDto.channel.CHANNEL_LOGIN,
          email: requireAuthingValue(input.email, "Email is required").toLowerCase(),
        });

    if (response.statusCode !== 200) {
      throw new AuthingPasscodeError(response.message || "Send passcode failed", response.apiCode);
    }
  }

  async loginWithAuthingPasscode(
    input: AuthingPasscodeLoginInput,
    sessionContext: SessionContextInput = {}
  ): Promise<AuthingPasscodeLoginResponse> {
    if (this.passcodeProvider(input.channel) === "local") {
      const target = normalizePasscodeTarget(input);
      await this.requireVerificationCodes().verify({ target, purpose: "login", code: input.passCode });
      const { user, isNewUser } = await this.userRepository.findOrCreateByContact(
        input.channel === "phone" ? { phone: target } : { email: target },
      );
      assertUserCanLogin(user);
      const result = await this.buildLoginResult(user, isNewUser, sessionContext);
      return { ...result, authingToken: signAccountToken(user.id) };
    }
    const client = this.createAuthingClient();
    const options = {
      scope: "openid profile email phone",
      autoRegister: true,
      ...(sessionContext.ip ? { clientIp: sessionContext.ip } : {}),
    };
    const response = input.channel === "phone"
      ? await client.signInByPhonePassCode({
          phone: requireAuthingValue(input.phone, "Phone is required"),
          phoneCountryCode: input.phoneCountryCode ?? "+86",
          passCode: input.passCode.trim(),
          options,
        })
      : await client.signInByEmailPassCode({
          email: requireAuthingValue(input.email, "Email is required").toLowerCase(),
          passCode: input.passCode.trim(),
          options,
        });

    const authingToken = response.data?.access_token?.trim() ?? "";
    if (response.statusCode !== 200 || !authingToken) {
      throw new AuthingPasscodeError(response.message || "Passcode login failed", response.apiCode);
    }

    const result = await this.loginWithAuthing({ authingToken }, sessionContext);
    return { ...result, authingToken };
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

    if (user.status === "pending_delete") {
      throw new Error("Account deletion is in progress");
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

  private async findUserByAccount(account: string): Promise<UserEntity | null> {
    const value = account.trim();
    if (isEmail(value)) return this.userRepository.findByEmail(value.toLowerCase());
    try {
      return await this.userRepository.findByPhone(normalizeCnPhone(value));
    } catch (error) {
      if (error instanceof InvalidContactError) return null; // a username: only Authing knows it
      throw error;
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
      nickname: resolveAuthingDisplayName(payload),
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

  private createAuthingClient(): AuthenticationClient {
    const config = getRuntimeConfig();
    if (!config.authingDomain || !config.authingAppId || !config.authingAppSecret) {
      throw new Error("AUTHING_DOMAIN / AUTHING_APP_ID / AUTHING_APP_SECRET is required");
    }
    return new AuthenticationClient({
      appId: config.authingAppId,
      appSecret: config.authingAppSecret,
      appHost: config.authingDomain.replace(/\/+$/, ""),
    });
  }
}

export class AuthingPasscodeError extends Error {
  constructor(message: string, readonly apiCode?: number) {
    super(message);
  }
}

function assertUserCanLogin(user: UserEntity): void {
  if (user.status === "pending_delete") throw new Error("Account deletion is in progress");
  if (user.status !== "active") throw new Error("Account is disabled");
}

function normalizePasscodeTarget(input: AuthingPasscodeInput): string {
  return input.channel === "phone"
    ? normalizeCnPhone(input.phone, input.phoneCountryCode)
    : normalizeEmailAddress(input.email);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhone(value: string): boolean {
  return /^\+?\d{6,20}$/.test(value);
}

function requireAuthingValue(value: string | undefined, message: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(message);
  return normalized;
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveAuthingDisplayName(payload: Record<string, unknown>): string | null {
  return (
    getStringPayloadValue(payload, "username") ??
    getStringPayloadValue(payload, "preferred_username") ??
    getStringPayloadValue(payload, "nickname") ??
    getStringPayloadValue(payload, "name") ??
    getStringPayloadValue(payload, "email") ??
    getStringPayloadValue(payload, "phone_number") ??
    getStringPayloadValue(payload, "phone")
  );
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function resolveRefreshExpiry(now: Date): Date {
  const ttlSeconds = getRuntimeConfig().authRefreshTokenTtlSeconds;
  return new Date(now.getTime() + ttlSeconds * 1000);
}
