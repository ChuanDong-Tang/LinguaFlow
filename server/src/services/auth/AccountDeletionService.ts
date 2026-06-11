import type { UserRepository } from "@lf/core/ports/repository/UserRepository.js";
import type { UserSessionRepository } from "@lf/core/ports/repository/UserSessionRepository.js";
import { AuthenticationClient, Models } from "authing-node-sdk";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

export interface ConfirmDeleteAccountInput {
  userId: string;
  authingToken: string;
  method: "PHONE_PASSCODE" | "EMAIL_PASSCODE";
  passCode: string;
}

export class AccountDeletionService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly userSessionRepository: UserSessionRepository
  ) {}

  async prepare(input: { userId: string; authingToken: string }): Promise<{
    authingToken: string;
    method: "PHONE_PASSCODE" | "EMAIL_PASSCODE";
    target: string;
  }> {
    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    await this.assertTokenBelongsToUser(input.userId, authingUser.sub);

    const client = this.createAuthingClient(input.authingToken);
    if (authingUser.phone) {
      const response = await client.sendSms({
        channel: Models.SendSMSDto.channel.CHANNEL_DELETE_ACCOUNT,
        phoneNumber: authingUser.phone,
        ...(authingUser.phoneCountryCode ? { phoneCountryCode: authingUser.phoneCountryCode } : {}),
      });
      if (response.statusCode !== 200) throw new Error(response.message || "Send delete account SMS failed");
      return {
        authingToken: input.authingToken,
        method: "PHONE_PASSCODE",
        target: maskPhone(authingUser.phone),
      };
    }

    if (authingUser.email) {
      const response = await client.sendEmail({
        channel: Models.SendEmailDto.channel.CHANNEL_DELETE_ACCOUNT,
        email: authingUser.email,
      });
      if (response.statusCode !== 200) throw new Error(response.message || "Send delete account email failed");
      return {
        authingToken: input.authingToken,
        method: "EMAIL_PASSCODE",
        target: maskEmail(authingUser.email),
      };
    }

    throw new Error("Current Authing account has no phone or email");
  }

  async confirm(input: ConfirmDeleteAccountInput): Promise<{ success: true }> {
    const authingUser = await this.resolveAuthingUserFromToken(input.authingToken);
    await this.assertTokenBelongsToUser(input.userId, authingUser.sub);

    const client = this.createAuthingClient(input.authingToken);
    const verified = await client.verifyDeleteAccountRequest(
      input.method === "PHONE_PASSCODE"
        ? {
            verifyMethod: Models.VerifyDeleteAccountRequestDto.verifyMethod.PHONE_PASSCODE,
            phonePassCodePayload: {
              phoneNumber: requireValue(authingUser.phone, "Authing account missing phone"),
              passCode: input.passCode,
              ...(authingUser.phoneCountryCode ? { phoneCountryCode: authingUser.phoneCountryCode } : {}),
            },
          }
        : {
            verifyMethod: Models.VerifyDeleteAccountRequestDto.verifyMethod.EMAIL_PASSCODE,
            emailPassCodePayload: {
              email: requireValue(authingUser.email, "Authing account missing email"),
              passCode: input.passCode,
            },
          }
    );

    const deleteAccountToken = verified.data?.deleteAccountToken;
    if (verified.statusCode !== 200 || !deleteAccountToken) {
      throw new Error(verified.message || "Verify delete account request failed");
    }

    const deleted = await client.deleteAccount({ deleteAccountToken });
    if (deleted.statusCode !== 200 || deleted.data?.success !== true) {
      throw new Error(deleted.message || "Delete Authing account failed");
    }

    const now = new Date();
    await this.userSessionRepository.revokeAllByUserId(input.userId, now);
    await this.userRepository.markPendingDeleteById(input.userId);

    return { success: true };
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
    phone: string | null;
    phoneCountryCode: string | null;
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
      phone: getStringPayloadValue(payload, "phone_number") ?? getStringPayloadValue(payload, "phone"),
      phoneCountryCode: getStringPayloadValue(payload, "phone_country_code") ?? "+86",
    };
  }
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireValue(value: string | null, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}
