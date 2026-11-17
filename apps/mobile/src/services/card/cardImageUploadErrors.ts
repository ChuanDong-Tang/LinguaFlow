/**
 * POST /cards answers 409 CARD_IMAGE_NOT_READY when a draft image's upload can
 * no longer be claimed: uploads expire after 24 hours and can be claimed once.
 * The draft still has the local files, so the caller re-uploads them.
 */
export function isExpiredImageUploadError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "CARD_IMAGE_NOT_READY";
}
