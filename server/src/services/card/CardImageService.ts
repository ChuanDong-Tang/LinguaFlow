import { createHash, randomUUID } from "node:crypto";
import type { CardRepository } from "@lf/core/ports/repository/CardRepository.js";
import type { CardImageStorageProvider } from "../../providers/storage/CardImageStorageProvider.js";
import type { TencentImsClient } from "../contentSafety/TencentImsClient.js";
import { CardNotFoundError, CardValidationError } from "./CardService.js";
import sharp from "sharp";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { EntitlementService } from "../entitlement/EntitlementService.js";
import type { UsageV2Service } from "../usage/UsageV2Service.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2_200;
const THUMBNAIL_VERSION = 5;
const IMAGE_DESCRIPTION_LEASE_MS = 15 * 60 * 1_000;
const LANDSCAPE_THUMBNAIL_SIZE = { width: 1_440, height: 960 } as const;
const PORTRAIT_THUMBNAIL_SIZE = { width: 1_152, height: 1_440 } as const;
const DEFAULT_BLOCK_SCORE = 80;
const POLITY_BLOCK_SCORE = 90;
const SOFT_BLOCK_LABELS = new Set(["ad", "ads", "advertising", "teenager"]);

type ModerationDecision = {
  status: "approved" | "approved_with_review" | "rejected";
  accepted: boolean;
  reason: string;
  blockScore: number | null;
};

export function decideCardImageModeration(input: {
  suggestion: string;
  label: string;
  score: number | null;
}): ModerationDecision {
  const suggestion = input.suggestion.trim().toLowerCase();
  if (suggestion === "pass") return { status: "approved", accepted: true, reason: "vendor_pass", blockScore: null };
  if (suggestion === "review") return { status: "approved_with_review", accepted: true, reason: "vendor_review", blockScore: null };
  if (suggestion !== "block") return { status: "rejected", accepted: false, reason: "unknown_vendor_suggestion", blockScore: null };

  // Missing or malformed scores retain Tencent's Block result rather than weakening moderation.
  if (input.score === null || !Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
    return { status: "rejected", accepted: false, reason: "vendor_block_without_valid_score", blockScore: null };
  }

  const label = input.label.trim().toLowerCase();
  if (SOFT_BLOCK_LABELS.has(label)) {
    return { status: "approved_with_review", accepted: true, reason: "soft_label_override", blockScore: null };
  }

  const blockScore = label === "polity" ? POLITY_BLOCK_SCORE : DEFAULT_BLOCK_SCORE;
  return input.score >= blockScore
    ? { status: "rejected", accepted: false, reason: "score_at_or_above_threshold", blockScore }
    : { status: "approved_with_review", accepted: true, reason: "score_below_threshold", blockScore };
}

export class CardImageModerationUnavailableError extends Error {
  readonly code = "CARD_IMAGE_MODERATION_UNAVAILABLE";
}

export class CardImageProcessingUnavailableError extends Error {
  readonly code = "CARD_IMAGE_PROCESSING_UNAVAILABLE";
}

export class CardImageQuotaExceededError extends Error {
  readonly code = "CARD_IMAGE_QUOTA_EXCEEDED";
}

export class CardImageService {
  constructor(
    private readonly repository: CardRepository,
    private readonly storage: CardImageStorageProvider,
    private readonly imsClient?: TencentImsClient,
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly entitlementService?: EntitlementService,
    private readonly usageV2Service?: UsageV2Service,
  ) {}

  async createUpload(input: {
    userId: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
    usageApiVersion?: "v2";
  }) {
    if (!['image/jpeg', 'image/png'].includes(input.mimeType)) throw new CardValidationError("只支持 JPEG 或 PNG 图片");
    if (!Number.isInteger(input.fileSize) || input.fileSize < 1 || input.fileSize > MAX_IMAGE_BYTES) throw new CardValidationError("图片大小不符合要求");
    if (![input.width, input.height].every((value) => Number.isInteger(value) && value > 0 && value <= MAX_IMAGE_EDGE)) throw new CardValidationError("图片尺寸不符合要求");
    const id = randomUUID();
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const objectKey = `card-isolated/${input.userId}/${id}/original.${extension}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    if (input.usageApiVersion === "v2") {
      if (!this.usageV2Service) throw new CardImageQuotaExceededError("V2 image usage is unavailable");
      await this.usageV2Service.reserveImageBytes({
        userId: input.userId,
        requestId: id,
        estimatedBytes: input.fileSize,
        imageId: id,
        objectKey,
      });
      try {
        await this.repository.createImageUpload({ id, userId: input.userId, objectKey, mimeType: input.mimeType, fileSize: input.fileSize, width: input.width, height: input.height, expiresAt });
      } catch (error) {
        await this.usageV2Service.releaseImageReservation(input.userId, id).catch(() => undefined);
        throw error;
      }
    } else {
      const entitlement = await this.entitlementService?.getCurrentEntitlement(input.userId);
      if (!entitlement) throw new CardImageQuotaExceededError("Image entitlement is unavailable");
      const reserved = await this.repository.createImageUploadWithinQuota({
        id, userId: input.userId, quotaDateKey: entitlement.dateKey, objectKey,
        mimeType: input.mimeType, fileSize: input.fileSize, width: input.width, height: input.height, expiresAt,
      });
      if (!reserved) throw new CardImageQuotaExceededError("Cloud image quota exceeded");
    }
    let upload: Awaited<ReturnType<CardImageStorageProvider["createUploadAuthorization"]>>;
    try {
      upload = await this.storage.createUploadAuthorization(objectKey);
    } catch (error) {
      await this.repository.markImageUploadCleanup(id, input.userId).catch(() => null);
      if (input.usageApiVersion === "v2") await this.usageV2Service?.releaseImageReservation(input.userId, id).catch(() => undefined);
      throw error;
    }
    return { uploadId: id, uploadUrl: upload.uploadUrl, headers: { ...upload.headers, "Content-Type": input.mimeType }, expiresAt: expiresAt.toISOString() };
  }

  async complete(userId: string, uploadId: string) {
    const asset = await this.repository.findImageUpload(uploadId, userId);
    if (!asset || asset.entryId || asset.expiresAt.getTime() <= Date.now()) throw new CardNotFoundError();
    if (asset.status === "approved" || asset.status === "approved_with_review") {
      await this.usageV2Service?.commitImageBytes({ userId, requestId: uploadId, actualBytes: asset.fileSize });
      return toStatus(await this.ensureThumbnail(asset));
    }
    if (asset.status === "rejected") {
      await this.usageV2Service?.releaseImageReservation(userId, uploadId);
      return toStatus(asset);
    }
    let bytes: Buffer;
    try { bytes = await this.storage.download(asset.originalObjectKey); }
    catch { throw new CardValidationError("没有找到已上传的图片"); }
    if (bytes.length !== asset.fileSize || bytes.length > MAX_IMAGE_BYTES) throw new CardValidationError("图片大小校验失败");
    const metadata = inspectStaticImage(bytes);
    if (!metadata || metadata.mimeType !== asset.mimeType || metadata.width !== asset.width || metadata.height !== asset.height) throw new CardValidationError("图片格式或尺寸校验失败");
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
      throw new CardImageModerationUnavailableError("Image moderation is unavailable");
    }
    let result;
    try {
      const signed = await this.storage.getSignedUrl(asset.originalObjectKey, 900);
      result = await this.imsClient.moderateImage({ fileUrl: signed.url, dataId: uploadId });
    } catch (error) {
      await this.repository.updateImageUploadModeration({ id: uploadId, userId, status: "moderation_failed", fileMd5 });
      await this.logModeration(userId, uploadId, { status: "failed", errorCode: "IMS_UNAVAILABLE" });
      throw new CardImageModerationUnavailableError("Image moderation is unavailable");
    }
    const decision = decideCardImageModeration(result);
    const status = decision.status;
    await this.logModeration(userId, uploadId, {
      status: decision.accepted ? "success" : "failed",
      errorCode: decision.accepted ? null : "CARD_IMAGE_REJECTED",
      vendorRequestId: result.requestId,
      suggestion: result.suggestion,
      label: result.label,
      subLabel: result.subLabel,
      score: result.score,
      decisionReason: decision.reason,
      blockScore: decision.blockScore,
    });
    const extension = asset.mimeType === "image/png" ? "png" : "jpg";
    const promotedObjectKey = `card-assets/${userId}/${uploadId}/original.${extension}`;
    if (status !== "rejected") {
      try {
        await this.storage.upload(promotedObjectKey, bytes, asset.mimeType);
      } catch {
        throw new CardImageProcessingUnavailableError("Image promotion failed");
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
    if (!updated) throw new CardNotFoundError();
    if (status === "rejected") await this.usageV2Service?.releaseImageReservation(userId, uploadId);
    else await this.usageV2Service?.commitImageBytes({ userId, requestId: uploadId, actualBytes: bytes.length });
    if (status !== "rejected") void this.storage.delete(asset.originalObjectKey).catch(() => undefined);
    return toStatus(status === "rejected" ? updated : await this.ensureThumbnail(updated, bytes));
  }

  async status(userId: string, uploadId: string) {
    const asset = await this.repository.findImageUpload(uploadId, userId);
    if (!asset) throw new CardNotFoundError();
    if ((asset.status === "approved" || asset.status === "approved_with_review") && (asset.thumbnailStatus !== "ready" || asset.thumbnailVersion < THUMBNAIL_VERSION)) {
      return toStatus(await this.ensureThumbnail(asset));
    }
    return toStatus(asset);
  }

  async remove(userId: string, uploadId: string): Promise<void> {
    const asset = await this.repository.markImageUploadCleanup(uploadId, userId);
    if (!asset) return;
    try {
      await this.storage.delete(asset.originalObjectKey);
      if (asset.status === "approved" || asset.status === "approved_with_review") {
        await this.usageV2Service?.releaseCommittedImage({
          userId,
          requestId: `remove:${uploadId}`,
          bytes: asset.fileSize,
          imageId: uploadId,
          objectKey: asset.originalObjectKey,
        });
      } else {
        await this.usageV2Service?.releaseImageReservation(userId, uploadId);
      }
    } catch { /* cleanup worker retries later */ }
  }

  async views(asset: NonNullable<Awaited<ReturnType<CardRepository["findImageUpload"]>>>) {
    const resolved = asset.thumbnailStatus !== "ready" || asset.thumbnailVersion < THUMBNAIL_VERSION
      ? await this.ensureThumbnail(asset)
      : asset;
    const original = await this.storage.getSignedUrl(resolved.originalObjectKey, 3_600);
    const thumbnail = resolved.thumbnailObjectKey
      ? await this.storage.getSignedUrl(resolved.thumbnailObjectKey, 3_600)
      : original;
    const landscape = resolved.width >= resolved.height;
    const hasCurrentThumbnail = Boolean(resolved.thumbnailObjectKey) && resolved.thumbnailVersion >= THUMBNAIL_VERSION;
    const thumbnailBounds = landscape ? LANDSCAPE_THUMBNAIL_SIZE : PORTRAIT_THUMBNAIL_SIZE;
    const thumbnailSize = containedImageSize(resolved.width, resolved.height, thumbnailBounds.width, thumbnailBounds.height);
    const descriptionStatus = isStaleImageDescription(resolved)
      ? "failed" as const
      : resolved.descriptionStatus;
    return {
      thumbnail: {
        id: resolved.id,
        url: thumbnail.url,
        urlExpiresAt: thumbnail.expiresAt.toISOString(),
        width: hasCurrentThumbnail ? thumbnailSize.width : resolved.thumbnailObjectKey ? 360 : resolved.width,
        height: hasCurrentThumbnail ? thumbnailSize.height : resolved.thumbnailObjectKey ? 360 : resolved.height,
      },
      image: {
        id: resolved.id,
        url: original.url,
        urlExpiresAt: original.expiresAt.toISOString(),
        width: resolved.width,
        height: resolved.height,
        focusX: resolved.focusX,
        focusY: resolved.focusY,
        aspect: landscape ? "3:2" as const : "4:5" as const,
        descriptionText: resolved.descriptionText,
        descriptionLanguageCode: resolved.descriptionLanguageCode,
        descriptionAuxiliarySegments: normalizeAuxiliarySegments(resolved.descriptionAuxiliarySegments),
        descriptionAuxiliaryLanguageCode: resolved.descriptionAuxiliaryLanguageCode,
        descriptionStatus,
      },
    };
  }

  private async ensureThumbnail(
    asset: NonNullable<Awaited<ReturnType<CardRepository["findImageUpload"]>>>,
    existingBytes?: Buffer,
  ) {
    if (asset.thumbnailObjectKey && asset.thumbnailStatus === "ready" && asset.thumbnailVersion >= THUMBNAIL_VERSION) return asset;
    try {
      const bytes = existingBytes ?? await this.storage.download(asset.originalObjectKey);
      const landscape = asset.width >= asset.height;
      const thumbnailSize = landscape ? LANDSCAPE_THUMBNAIL_SIZE : PORTRAIT_THUMBNAIL_SIZE;
      const thumbnail = await sharp(bytes)
        .rotate()
        .resize(thumbnailSize.width, thumbnailSize.height, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      const thumbnailObjectKey = asset.originalObjectKey.replace(/\/original\.[^.]+$/u, `/thumbnail-v${THUMBNAIL_VERSION}.jpg`);
      await this.storage.upload(thumbnailObjectKey, thumbnail, "image/jpeg");
      const updated = await this.repository.updateImageThumbnail({
        id: asset.id,
        userId: asset.userId,
        thumbnailObjectKey,
        thumbnailVersion: THUMBNAIL_VERSION,
      });
      if (updated && asset.thumbnailObjectKey && asset.thumbnailObjectKey !== thumbnailObjectKey) {
        await this.storage.delete(asset.thumbnailObjectKey).catch(() => undefined);
      }
      return updated ?? asset;
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
      subLabel?: string;
      score?: number | null;
      decisionReason?: string;
      blockScore?: number | null;
    },
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        userId,
        module: "card",
        event: "card.image.moderation",
        level: input.status === "success" ? "info" : "warn",
        status: input.status,
        errorCode: input.errorCode,
        metadata: {
          uploadId,
          vendorRequestId: input.vendorRequestId ?? null,
          suggestion: input.suggestion ?? null,
          label: input.label ?? null,
          subLabel: input.subLabel ?? null,
          score: input.score ?? null,
          decisionReason: input.decisionReason ?? null,
          blockScore: input.blockScore ?? null,
        },
      });
    } catch {
      // Audit logging must not alter image moderation.
    }
  }
}

function isStaleImageDescription(asset: {
  descriptionStatus: string;
  descriptionUpdatedAt: Date | null;
}): boolean {
  return (asset.descriptionStatus === "pending" || asset.descriptionStatus === "auxiliary_pending")
    && (!asset.descriptionUpdatedAt || asset.descriptionUpdatedAt.getTime() <= Date.now() - IMAGE_DESCRIPTION_LEASE_MS);
}

function normalizeAuxiliarySegments(value: unknown): Array<{ ordinal: number; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => row && typeof row === "object"
    && Number.isInteger((row as { ordinal?: unknown }).ordinal)
    && typeof (row as { text?: unknown }).text === "string"
    && (row as { text: string }).text.trim()
    ? [{ ordinal: (row as { ordinal: number }).ordinal, text: (row as { text: string }).text.trim() }]
    : []);
}

function containedImageSize(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function toStatus(asset: Awaited<ReturnType<CardRepository["findImageUpload"]>> & {}) {
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
