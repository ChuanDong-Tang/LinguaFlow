const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "api-unconfigured";

export function environmentStorageKey(key: string): string {
  return `${key}.${normalizeStorageScope(API_BASE_URL)}`;
}

function normalizeStorageScope(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "api-unconfigured";
  try {
    const url = new URL(trimmed);
    return sanitizeStorageScope(url.host);
  } catch {
    return sanitizeStorageScope(trimmed);
  }
}

function sanitizeStorageScope(value: string): string {
  return value.replace(/[^a-z0-9.-]+/g, "_").slice(0, 80) || "api-unconfigured";
}
