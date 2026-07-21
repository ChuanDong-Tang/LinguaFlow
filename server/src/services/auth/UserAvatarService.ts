import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { UserProfileRepository } from "@lf/core/ports/repository/UserProfileRepository.js";
import type { JournalImageStorageProvider } from "../../providers/storage/JournalImageStorageProvider.js";
import type { TencentImsClient } from "../contentSafety/TencentImsClient.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

export class AvatarValidationError extends Error { readonly code = "AVATAR_VALIDATION_FAILED"; }
export class AvatarNotFoundError extends Error { readonly code = "AVATAR_NOT_FOUND"; }
export class AvatarModerationRejectedError extends Error { readonly code = "AVATAR_MODERATION_REJECTED"; }
export class AvatarModerationUnavailableError extends Error { readonly code = "AVATAR_MODERATION_UNAVAILABLE"; }

export class UserAvatarService {
  constructor(
    private readonly repository: UserProfileRepository,
    private readonly storage: JournalImageStorageProvider,
    private readonly imsClient?: TencentImsClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
  ) {}

  async createUpload(input: { userId: string; fileSize: number; width: number; height: number }) {
    if (!Number.isInteger(input.fileSize) || input.fileSize < 1 || input.fileSize > 5 * 1024 * 1024) throw new AvatarValidationError("头像大小不符合要求");
    if (![input.width, input.height].every((value) => Number.isInteger(value) && value > 0 && value <= 4096)) throw new AvatarValidationError("头像尺寸不符合要求");
    const id = randomUUID();
    const originalObjectKey = `avatar-isolated/${input.userId}/${id}/original.jpg`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    await this.repository.createAvatarAsset({
      id,
      userId: input.userId,
      originalObjectKey,
      mimeType: "image/jpeg",
      fileSize: input.fileSize,
      width: input.width,
      height: input.height,
      expiresAt,
    });
    const upload = await this.storage.createUploadAuthorization(originalObjectKey);
    return { uploadId: id, uploadUrl: upload.uploadUrl, headers: { ...upload.headers, "Content-Type": "image/jpeg" }, expiresAt: expiresAt.toISOString() };
  }

  async complete(userId: string, uploadId: string, requestId?: string): Promise<void> {
    const asset = await this.repository.findAvatarAsset(uploadId, userId);
    if (asset?.status === "ready") {
      const current = await this.repository.findCurrentAvatar(userId);
      if (current?.id === asset.id) return;
      throw new AvatarNotFoundError();
    }
    if (!asset || (asset.expiresAt && asset.expiresAt.getTime() <= Date.now())) throw new AvatarNotFoundError();
    const bytes = await this.storage.download(asset.originalObjectKey).catch(() => { throw new AvatarValidationError("没有找到已上传的头像"); });
    if (bytes.length !== asset.fileSize) throw new AvatarValidationError("头像大小校验失败");
    const image = sharp(bytes, { failOn: "error" }).rotate();
    const metadata = await image.metadata().catch(() => { throw new AvatarValidationError("头像格式校验失败"); });
    if (metadata.format !== "jpeg" || metadata.width !== asset.width || metadata.height !== asset.height) throw new AvatarValidationError("头像格式或尺寸校验失败");
    if (!this.imsClient) {
      await this.repository.markAvatarFailed(uploadId, userId, "moderation_failed");
      throw new AvatarModerationUnavailableError();
    }
    let moderation;
    try {
      const signed = await this.storage.getSignedUrl(asset.originalObjectKey, 900);
      moderation = await this.imsClient.moderateImage({ fileUrl: signed.url, dataId: uploadId });
    } catch {
      await this.repository.markAvatarFailed(uploadId, userId, "moderation_failed");
      await this.logModeration({ userId, requestId, status: "failed", errorCode: "IMS_UNAVAILABLE" });
      throw new AvatarModerationUnavailableError();
    }
    await this.logModeration({
      userId,
      requestId,
      status: moderation.suggestion === "Pass" ? "success" : "failed",
      errorCode: moderation.suggestion === "Pass" ? null : "AVATAR_MODERATION_REJECTED",
      vendorRequestId: moderation.requestId,
      suggestion: moderation.suggestion,
      label: moderation.label,
    });
    if (moderation.suggestion !== "Pass") {
      await this.repository.markAvatarFailed(uploadId, userId, "rejected");
      throw new AvatarModerationRejectedError();
    }
    const originalObjectKey = `avatars/${userId}/${uploadId}/original.jpg`;
    const profileObjectKey = `avatars/${userId}/${uploadId}/profile-512.jpg`;
    const thumbnailObjectKey = `avatars/${userId}/${uploadId}/thumbnail-128.jpg`;
    try {
      const square = sharp(bytes).rotate().resize(512, 512, { fit: "cover", position: "centre" });
      const [profile, thumbnail] = await Promise.all([
        square.clone().jpeg({ quality: 88, mozjpeg: true }).toBuffer(),
        square.clone().resize(128, 128).jpeg({ quality: 84, mozjpeg: true }).toBuffer(),
      ]);
      await Promise.all([
        this.storage.upload(originalObjectKey, bytes, "image/jpeg"),
        this.storage.upload(profileObjectKey, profile, "image/jpeg"),
        this.storage.upload(thumbnailObjectKey, thumbnail, "image/jpeg"),
      ]);
    } catch {
      await this.repository.markAvatarFailed(uploadId, userId, "derivation_failed");
      await Promise.allSettled([
        this.storage.delete(profileObjectKey),
        this.storage.delete(thumbnailObjectKey),
        this.storage.delete(originalObjectKey),
      ]);
      throw new AvatarModerationUnavailableError();
    }
    const activated = await this.repository.activateAvatar({
      id: uploadId,
      userId,
      originalObjectKey,
      profileObjectKey,
      thumbnailObjectKey,
      fileMd5: createHash("md5").update(bytes).digest("hex"),
      moderationRequestId: moderation.requestId,
      moderationSuggestion: moderation.suggestion,
      moderationLabel: moderation.label,
    });
    void this.storage.delete(asset.originalObjectKey).catch(() => undefined);
    if (activated.previous) void this.deleteAssetObjects(activated.previous);
  }

  async remove(userId: string): Promise<void> {
    const previous = await this.repository.removeCurrentAvatar(userId);
    if (previous) await this.deleteAssetObjects(previous);
  }

  private async deleteAssetObjects(asset: { originalObjectKey: string; profileObjectKey: string | null; thumbnailObjectKey: string | null }): Promise<void> {
    await Promise.allSettled([
      this.storage.delete(asset.originalObjectKey),
      ...(asset.profileObjectKey ? [this.storage.delete(asset.profileObjectKey)] : []),
      ...(asset.thumbnailObjectKey ? [this.storage.delete(asset.thumbnailObjectKey)] : []),
    ]);
  }

  private async logModeration(input: {
    userId: string;
    requestId?: string;
    status: "success" | "failed";
    errorCode: string | null;
    vendorRequestId?: string;
    suggestion?: string;
    label?: string;
  }): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: input.requestId,
        userId: input.userId,
        module: "profile",
        event: "profile.avatar.moderation",
        level: input.status === "success" ? "info" : "warn",
        status: input.status,
        errorCode: input.errorCode,
        metadata: {
          vendorRequestId: input.vendorRequestId ?? null,
          suggestion: input.suggestion ?? null,
          label: input.label ?? null,
        },
      });
    } catch {
      // Audit logging must not alter the moderation result.
    }
  }
}
