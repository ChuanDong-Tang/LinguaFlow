export type QuotaExhaustionKind = "token" | "image";

type QuotaExhaustionHandler = (kind: QuotaExhaustionKind) => void;

let activeHandler: QuotaExhaustionHandler | null = null;
let lastNotificationAt = 0;

export function setQuotaExhaustionHandler(handler: QuotaExhaustionHandler | null): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function notifyQuotaExhaustion(kind: QuotaExhaustionKind): void {
  const now = Date.now();
  if (now - lastNotificationAt < 1_000) return;
  lastNotificationAt = now;
  activeHandler?.(kind);
}

export function quotaExhaustionKindForCode(code: string): QuotaExhaustionKind | null {
  if (code === "TOKEN_QUOTA_EXCEEDED" || code === "DAILY_QUOTA_EXCEEDED") return "token";
  if (code === "IMAGE_STORAGE_QUOTA_EXCEEDED" || code === "CARD_IMAGE_QUOTA_EXCEEDED") return "image";
  return null;
}
