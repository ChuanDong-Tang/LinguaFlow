import type { UsageV2 } from "../api/meApi";

export type ImageUploadBatch = { count: number; bytes: number };

/**
 * Photos and videos share one upload allowance: a daily upload count and the
 * period's storage bytes. Decide whether a whole batch fits before any upload.
 */
export function imageUploadVerdict(images: UsageV2["images"], batch: ImageUploadBatch): "ok" | "image_daily" | "image" {
  if (typeof images.dailyUploadsUsed === "number" && images.dailyUploadsUsed + batch.count > images.dailyUploadLimit) return "image_daily";
  const remaining = Number(images.remainingUploadBytes ?? images.remainingBytes);
  if (Number.isFinite(remaining) && batch.bytes > remaining) return "image";
  return "ok";
}
