import type { UserEntity, UserRepository } from "@lf/core/ports/repository/UserRepository.js";
import { AuthenticationClient, Models } from "authing-node-sdk";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export class EmailAlreadyBoundError extends Error {
  readonly code = "EMAIL_ALREADY_BOUND";

  constructor(message = "Current account already has email") {
    super(message);
  }
}

export class EmailTakenError extends Error {
  readonly code = "EMAIL_TAKEN";

  constructor(message = "Email is already bound to another account") {
    super(message);
  }
}

export class AccountEmailBindingService {
  constructor(private readonly userRepository: UserRepository) {}

  async prepare(input: { userId: string; authingToken: string; email: string }): Promise<{
    authingToken: string;
    email: string;
    target: string;
  }> {
    const email = normalizeEmail(input.email);
    await this.assertEmailCanBeBound(input.userId, email);

    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    await this.assertTokenBelongsToUser(input.userId, authingUser.sub);
    if (authingUser.email) {
      throw new EmailAlreadyBoundError("Authing account already has email");
    }

    const client = this.createAuthingClient(input.authingToken);
    const response = await client.sendEmail({
      channel: Models.SendEmailDto.channel.CHANNEL_BIND_EMAIL,
      email,
    });
    if (response.statusCode !== 200) {
      throw mapAuthingEmailError(response.message || "Send bind email code failed", response.apiCode);
    }

    return {
      authingToken: input.authingToken,
      email,
      target: maskEmail(email),
    };
  }

  async confirm(input: { userId: string; authingToken: string; email: string; passCode: string }): Promise<UserEntity> {
    const email = normalizeEmail(input.email);
    await this.assertEmailCanBeBound(input.userId, email);

    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    await this.assertTokenBelongsToUser(input.userId, authingUser.sub);
    if (authingUser.email) {
      throw new EmailAlreadyBoundError("Authing account already has email");
    }

    const client = this.createAuthingClient(input.authingToken);
    const response = await client.bindEmail({
      email,
      passCode: input.passCode.trim(),
    });
    if (response.statusCode !== 200) {
      throw mapAuthingEmailError(response.message || "Bind email failed", response.apiCode);
    }

    return this.userRepository.updateEmailById(input.userId, email);
  }

  private async assertEmailCanBeBound(userId: string, email: string): Promise<void> {
    const current = await this.userRepository.findById(userId);
    if (!current) throw new Error("User not found");
    if (current.email?.trim()) {
      throw new EmailAlreadyBoundError();
    }

    const owner = await this.userRepository.findByEmail(email);
    if (owner && owner.id !== userId) {
      throw new EmailTakenError();
    }
  }

  private async assertTokenBelongsToUser(userId: string, authingSub: string): Promise<void> {
    const localUser = await this.userRepository.findByAuthIdentity("authing", authingSub);

    if (!localUser || localUser.id !== userId) {
      throw new Error("Authing account does not match current user");
    }
  }

  private createAuthingClient(accessToken: string): AuthenticationClient {
    const config = getRuntimeConfig();
    const domain = config.authingDomain;
    const appId = config.authingAppId;
    const appSecret = config.authingAppSecret;
    if (!domain || !appId || !appSecret) {
      throw new Error("AUTHING_DOMAIN / AUTHING_APP_ID / AUTHING_APP_SECRET is required");
    }

    return new AuthenticationClient({
      appId,
      appSecret,
      appHost: domain.replace(/\/+$/, ""),
      accessToken,
    });
  }

  private async resolveAuthingUserFromToken(authingToken: string): Promise<{
    sub: string;
    email: string | null;
  }> {
    const domain = getRuntimeConfig().authingDomain;
    if (!domain) throw new Error("AUTHING_DOMAIN is required");

    const response = await fetch(`${domain.replace(/\/+$/, "")}/oidc/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${authingToken}` },
    });
    if (!response.ok) {
      throw new Error(`Authing token validation failed: ${response.status}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) throw new Error("Authing token payload missing sub");
    return {
      sub,
      email: getStringPayloadValue(payload, "email"),
    };
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email");
  }
  return normalized;
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapAuthingEmailError(message: string, apiCode?: number): Error {
  if (apiCode === 1320004 || apiCode === 2200 || /已.*绑定|already.*bound/i.test(message)) {
    return new EmailTakenError(message);
  }
  return new Error(message);
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}
