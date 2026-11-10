import { getUsageV2, type UsageV2 } from "../api/meApi";
import { notifyQuotaExhaustion } from "./quotaExhaustion";
import { imageUploadVerdict, type ImageUploadBatch } from "./imageUploadVerdict";

export type { ImageUploadBatch };

/**
 * Check once before an upload starts. When the batch does not fit, refuse it
 * and show the recharge / wait-for-refresh dialog. If usage cannot be read the
 * upload proceeds and the server stays authoritative.
 */
export async function ensureImageUploadQuota(batch: ImageUploadBatch): Promise<boolean> {
  if (batch.count < 1) return true;
  let usage: UsageV2;
  try { usage = await getUsageV2(); } catch { return true; }
  const verdict = imageUploadVerdict(usage.images, batch);
  if (verdict === "ok") return true;
  notifyQuotaExhaustion(verdict);
  return false;
}
