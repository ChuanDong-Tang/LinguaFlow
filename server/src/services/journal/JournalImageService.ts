import { createHash, randomUUID } from "node:crypto";
import type { JournalRepository } from "@lf/core/ports/repository/JournalRepository.js";
import type { JournalImageStorageProvider } from "../../providers/storage/JournalImageStorageProvider.js";
import type { TencentImsClient } from "../contentSafety/TencentImsClient.js";
import { JournalNotFoundError, JournalValidationError } from "./JournalService.js";
import sharp from "sharp";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2_200;

export class JournalImageModerationUnavailableError extends Error {
  readonly code = "JOURNAL_IMAGE_MODERATION_UNAVAILABLE";
}

export class JournalImageProcessingUnavailableError extends Error {
  readonly code = "JOURNAL_IMAGE_PROCESSING_UNAVAILABLE";
}

export class JournalImageService {
  constructor(
    private readonly repository: JournalRepository,
    private readonly storage: JournalImageStorageProvider,
    private readonly imsClient?: TencentImsClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
  ) {}

  async createUpload(input: {
    userId: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
  }) {
    if (!['image/jpeg', 'image/png'].includes(input.mimeType)) throw new JournalValidationError("只支持 JPEG 或 PNG 图片");
    if (!Number.isInteger(input.fileSize) || input.fileSize < 1 || input.fileSize > MAX_IMAGE_BYTES) throw new JournalValidationError("图片大小不符合要求");
    if (![input.width, input.height].every((value) => Number.isInteger(value) && value > 0 && value <= MAX_IMAGE_EDGE)) throw new JournalValidationError("图片尺寸不符合要求");
    const ratio = input.width / input.height;
    if (Math.min(Math.abs(ratio - 3 / 2), Math.abs(ratio - 4 / 5)) > 0.02) {
      throw new JournalValidationError("图片需要裁剪为横向 3:2 或竖向 4:5");
    }
    const id = randomUUID();
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const objectKey = `journal-isolated/${input.userId}/${id}/original.${extension}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    await this.repository.createImageUpload({ id, userId: input.userId, objectKey, mimeType: input.mimeType, fileSize: input.fileSize, width: input.width, height: input.height, expiresAt });
    const upload = await this.storage.createUploadAuthorization(objectKey);
    return { uploadId: id, uploadUrl: upload.uploadUrl, headers: { ...upload.headers, "Content-Type": input.mimeType }, expiresAt: expiresAt.toISOString() };
  }

  async complete(userId: string, uploadId: string) {
    const asset = await this.repository.findImageUpload(uploadId, userId);
    if (!asset || asset.entryId || asset.expiresAt.getTime() <= Date.now()) throw new JournalNotFoundError();
    if (asset.status === "approved" || asset.status === "approved_with_review") {
      return toStatus(await this.ensureThumbnail(asset));
    }
    if (asset.status === "rejected") return toStatus(asset);
    let bytes: Buffer;
    try { bytes = await this.storage.download(asset.originalObjectKey); }
    catch { throw new JournalValidationError("没有找到已上传的图片"); }
    if (bytes.length !== asset.fileSize || bytes.length > MAX_IMAGE_BYTES) throw new JournalValidationError("图片大小校验失败");
    const metadata = inspectStaticImage(bytes);
    if (!metadata || metadata.mimeType !== asset.mimeType || metadata.width !== asset.width || metadata.height !== asset.height) throw new JournalValidationError("图片格式或尺寸校验失败");
    const fileMd5 = createHash("md5").update(bytes).digest("hex");
    await this.repository.updateImageUploadModeration({
      id: uploadId,
      userId,
      status: "moderating",
      fileMd5,
    });
    if (!this.imsClient) {
      await this.repository.updateImageUploadModeration({ id: uploadId, userId, status: "moderation_failed", fileMd5 });
      await this.logModeration(userId, uploadId, { status: "failed", errorCode: "IMS_NOT_CONFIGURED" });
      throw new JournalImageModerationUnavailableError("Image moderation is unavailable");
    }
    let result;
    try {
      const signed = await this.storage.getSignedUrl(asset.originalObjectKey, 900);
      result = await this.imsClient.moderateImage({ fileUrl: signed.url, dataId: uploadId });
    } catch (error) {
      await this.repository.updateImageUploadModeration({ id: uploadId, userId, status: "moderation_failed", fileMd5 });
      await this.logModeration(userId, uploadId, { status: "failed", errorCode: "IMS_UNAVAILABLE" });
      throw new JournalImageModerationUnavailableError("Image moderation is unavailable");
    }
    const status = result.suggestion === "Pass"
      ? "approved"
      : result.suggestion === "Review"
        ? "approved_with_review"
        : "rejected";
    const moderationAccepted = result.suggestion === "Pass" || result.suggestion === "Review";
    await this.logModeration(userId, uploadId, {
      status: moderationAccepted ? "success" : "failed",
      errorCode: moderationAccepted ? null : "JOURNAL_IMAGE_REJECTED",
      vendorRequestId: result.requestId,
      suggestion: result.suggestion,
      label: result.label,
    });
    const extension = asset.mimeType === "image/png" ? "png" : "jpg";
    const promotedObjectKey = `journal-assets/${userId}/${uploadId}/original.${extension}`;
    if (status !== "rejected") {
      try {
        await this.storage.upload(promotedObjectKey, bytes, asset.mimeType);
      } catch {
        throw new JournalImageProcessingUnavailableError("Image promotion failed");
      }
    }
    const updated = await this.repository.updateImageUploadModeration({
      id: uploadId,
      userId,
      status,
      fileMd5,
      moderationRequestId: result.requestId,
      moderationSuggestion: result.suggestion,
      moderationLabel: result.label,
      originalObjectKey: status === "rejected" ? undefined : promotedObjectKey,
    });
    if (!updated) throw new JournalNotFoundError();
    if (status !== "rejected") void this.storage.delete(asset.originalObjectKey).catch(() => undefined);
    return toStatus(status === "rejected" ? updated : await this.ensureThumbnail(updated, bytes));
  }

  async status(userId: string, uploadId: string) {
    const asset = await this.repository.findImageUpload(uploadId, userId);
    if (!asset) throw new JournalNotFoundError();
    if ((asset.status === "approved" || asset.status === "approved_with_review") && asset.thumbnailStatus !== "ready") {
      return toStatus(await this.ensureThumbnail(asset));
    }
    return toStatus(asset);
  }

  async remove(userId: string, uploadId: string): Promise<void> {
    const asset = await this.repository.markImageUploadCleanup(uploadId, userId);
    if (!asset) return;
    try { await this.storage.delete(asset.originalObjectKey); } catch { /* cleanup worker retries later */ }
  }

  async views(asset: NonNullable<Awaited<ReturnType<JournalRepository["findImageUpload"]>>>) {
    const original = await this.storage.getSignedUrl(asset.originalObjectKey, 3_600);
    const thumbnail = asset.thumbnailObjectKey
      ? await this.storage.getSignedUrl(asset.thumbnailObjectKey, 3_600)
      : original;
    return {
      thumbnail: {
        url: thumbnail.url,
        urlExpiresAt: thumbnail.expiresAt.toISOString(),
        width: asset.thumbnailObjectKey ? 360 : asset.width,
        height: asset.thumbnailObjectKey ? 360 : asset.height,
      },
      image: {
        url: original.url,
        urlExpiresAt: original.expiresAt.toISOString(),
        width: asset.width,
        height: asset.height,
        aspect: asset.width >= asset.height ? "3:2" as const : "4:5" as const,
      },
    };
  }

  private async ensureThumbnail(
    asset: NonNullable<Awaited<ReturnType<JournalRepository["findImageUpload"]>>>,
    existingBytes?: Buffer,
  ) {
    if (asset.thumbnailObjectKey && asset.thumbnailStatus === "ready") return asset;
    try {
      const bytes = existingBytes ?? await this.storage.download(asset.originalObjectKey);
      const thumbnail = await sharp(bytes)
        .rotate()
        .resize(360, 360, { fit: "cover", position: "centre" })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer();
      const thumbnailObjectKey = asset.originalObjectKey.replace(/\/original\.[^.]+$/u, "/thumbnail-v1.jpg");
      await this.storage.upload(thumbnailObjectKey, thumbnail, "image/jpeg");
      return await this.repository.updateImageThumbnail({
        id: asset.id,
        userId: asset.userId,
        thumbnailObjectKey,
        thumbnailVersion: 1,
      }) ?? asset;
    } catch {
      return asset;
    }
  }

  private async logModeration(
    userId: string,
    uploadId: string,
    input: {
      status: "success" | "failed";
      errorCode: string | null;
      vendorRequestId?: string;
      suggestion?: string;
      label?: string;
    },
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        userId,
        module: "journal",
        event: "journal.image.moderation",
        level: input.status === "success" ? "info" : "warn",
        status: input.status,
        errorCode: input.errorCode,
        metadata: {
          uploadId,
          vendorRequestId: input.vendorRequestId ?? null,
          suggestion: input.suggestion ?? null,
          label: input.label ?? null,
        },
      });
    } catch {
      // Audit logging must not alter image moderation.
    }
  }
}

function toStatus(asset: Awaited<ReturnType<JournalRepository["findImageUpload"]>> & {}) {
  return { uploadId: asset!.id, status: asset!.status, expiresAt: asset!.expiresAt.toISOString() };
}

function inspectStaticImage(bytes: Buffer): { mimeType: "image/jpeg" | "image/png"; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { mimeType: "image/jpeg", height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}
