import { countGraphemes } from "@lf/core/text/grapheme.js";
import type { UserProfileRepository } from "@lf/core/ports/repository/UserProfileRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { UserBindingsView, UserProfileView } from "@lf/core/types/profile.js";
import type { TencentTmsClient } from "../contentSafety/TencentTmsClient.js";
import { generateDefaultProfileNickname } from "./profileNickname.js";
import type { CardImageStorageProvider } from "../../providers/storage/CardImageStorageProvider.js";

export class InvalidProfileNicknameError extends Error {
  readonly code = "PROFILE_NICKNAME_INVALID";
}

export class ProfileNicknameBlockedError extends Error {
  readonly code = "PROFILE_NICKNAME_BLOCKED";
}

export class ProfileModerationUnavailableError extends Error {
  readonly code = "PROFILE_MODERATION_UNAVAILABLE";
}

export class UserProfileService {
  constructor(
    private readonly repository: UserProfileRepository,
    private readonly tmsClient?: TencentTmsClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly avatarStorage?: CardImageStorageProvider,
  ) {}

  async getProfile(userId: string): Promise<UserProfileView> {
    const profile = await this.ensureProfile(userId);
    let avatar: UserProfileView["avatar"] = null;
    if (profile.avatarAssetId && this.avatarStorage) {
      const asset = await this.repository.findCurrentAvatar(userId);
      if (asset?.profileObjectKey && asset.thumbnailObjectKey && asset.status === "ready") {
        try {
          const [profileUrl, thumbnailUrl] = await Promise.all([
            this.avatarStorage.getSignedUrl(asset.profileObjectKey, 3_600),
            this.avatarStorage.getSignedUrl(asset.thumbnailObjectKey, 3_600),
          ]);
          avatar = {
            url: profileUrl.url,
            thumbnailUrl: thumbnailUrl.url,
            urlExpiresAt: new Date(Math.min(profileUrl.expiresAt.getTime(), thumbnailUrl.expiresAt.getTime())).toISOString(),
          };
        } catch { avatar = null; }
      }
    }
    return {
      userId: profile.userId,
      nickname: profile.nickname,
      nicknameSource: profile.nicknameSource,
      registrationMethod: profile.registrationMethod,
      avatar,
      avatarKind: avatar ? "custom" : "default",
    };
  }

  async getBindings(userId: string): Promise<UserBindingsView> {
    const profile = await this.ensureProfile(userId);
    const bindings = await this.repository.findBindings(userId);
    if (!bindings) throw new Error("USER_NOT_FOUND");

    return {
      registrationMethod: profile.registrationMethod,
      phone: {
        bound: Boolean(bindings.phone),
        maskedValue: bindings.phone ? maskPhone(bindings.phone) : null,
        action: bindings.phone ? "none" : "unsupported",
      },
      email: {
        bound: Boolean(bindings.email),
        maskedValue: bindings.email ? maskEmail(bindings.email) : null,
        action: bindings.email ? "none" : profile.registrationMethod === "phone" ? "bind" : "none",
      },
    };
  }

  async updateNickname(input: { userId: string; nickname: string; requestId: string }): Promise<UserProfileView> {
    await this.ensureProfile(input.userId);
    const nickname = normalizeProfileNickname(input.nickname);
    const startedAt = Date.now();

    if (!this.tmsClient) {
      await this.logNicknameModeration(input, {
        status: "failed",
        errorCode: "TMS_NOT_CONFIGURED",
        durationMs: Date.now() - startedAt,
      });
      throw new ProfileModerationUnavailableError("Nickname moderation is unavailable");
    }

    let result;
    try {
      result = await this.tmsClient.moderateText({
        text: nickname,
        dataId: input.requestId,
        userId: input.userId,
      });
    } catch (error) {
      await this.logNicknameModeration(input, {
        status: "failed",
        errorCode: resolveErrorCode(error),
        durationMs: Date.now() - startedAt,
      });
      throw new ProfileModerationUnavailableError("Nickname moderation is unavailable");
    }

    await this.logNicknameModeration(input, {
      status: result.suggestion === "Pass" ? "success" : "failed",
      errorCode: result.suggestion === "Pass" ? null : "PROFILE_NICKNAME_BLOCKED",
      durationMs: Date.now() - startedAt,
      requestId: result.requestId,
      suggestion: result.suggestion,
      label: result.label,
      subLabel: result.subLabel,
      score: result.score,
    });

    if (result.suggestion !== "Pass") {
      throw new ProfileNicknameBlockedError("Nickname is not allowed");
    }

    await this.repository.updateNickname({
      userId: input.userId,
      nickname,
      nicknameSource: "user_custom",
    });
    return this.getProfile(input.userId);
  }

  private async ensureProfile(userId: string) {
    const existing = await this.repository.findByUserId(userId);
    if (existing) return existing;
    const bindings = await this.repository.findBindings(userId);
    if (!bindings) throw new Error("USER_NOT_FOUND");
    return this.repository.ensure({
      userId,
      defaultNickname: generateDefaultProfileNickname(),
      registrationMethod: bindings.phone ? "phone" : "email",
    });
  }

  private async logNicknameModeration(
    input: { userId: string; requestId: string },
    result: {
      status: "success" | "failed";
      errorCode: string | null;
      durationMs: number;
      requestId?: string;
      suggestion?: string;
      label?: string;
      subLabel?: string;
      score?: number;
    },
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: input.requestId,
        userId: input.userId,
        module: "profile",
        event: "profile.nickname.moderation",
        level: result.status === "success" ? "info" : "warn",
        status: result.status,
        errorCode: result.errorCode,
        metadata: {
          vendorRequestId: result.requestId ?? null,
          suggestion: result.suggestion ?? null,
          label: result.label ?? null,
          subLabel: result.subLabel ?? null,
          score: result.score ?? null,
          durationMs: result.durationMs,
        },
      });
    } catch {
      // Audit logging must not alter the moderation result.
    }
  }
}

export function normalizeProfileNickname(value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new InvalidProfileNicknameError("Nickname contains unsupported characters");
  }
  const nickname = value.trim().replace(/\s+/gu, " ");
  const length = countGraphemes(nickname);
  if (length < 1 || length > 24) throw new InvalidProfileNicknameError("Nickname length is invalid");
  if (/\p{C}/u.test(nickname.replace(/\u200D/gu, ""))) {
    throw new InvalidProfileNicknameError("Nickname contains unsupported characters");
  }
  if (!/[\p{L}\p{N}]/u.test(nickname)) {
    throw new InvalidProfileNicknameError("Nickname must contain a letter or number");
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(nickname) || /^\+?\d[\d\s-]{6,}\d$/u.test(nickname)) {
    throw new InvalidProfileNicknameError("Nickname must not expose an email or phone number");
  }
  return nickname;
}

export function maskPhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 7) return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const normalized = value.trim();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0) return "***";
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

function resolveErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return error instanceof Error ? error.name : "UNKNOWN";
}
