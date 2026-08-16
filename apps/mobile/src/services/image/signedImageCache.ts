import { Image } from "react-native";
import type { UserProfile } from "../api/meApi";

const IMAGE_PRELOAD_TIMEOUT_MS = 4_000;
const MAX_MEMORY_ENTRIES = 512;
const signedUrlMemoryCache = new Map<string, SignedImageUrl>();

export type SignedImageUrl = {
  url: string;
  urlExpiresAt?: string | null;
};

/**
 * COS signs the same object with a different query string on every request.
 * React Native uses the complete URL as its cache key, so compare the stable
 * object URL instead of the temporary signature.
 */
export function getRemoteImageIdentity(url: string): string {
  return url.split("#", 1)[0].split("?", 1)[0];
}

export function canKeepSignedImage(
  previous: SignedImageUrl | null | undefined,
  next: SignedImageUrl | null | undefined,
  refreshLeadMs: number,
): boolean {
  if (!previous?.url || !next?.url) return false;
  if (getRemoteImageIdentity(previous.url) !== getRemoteImageIdentity(next.url)) return false;
  if (previous.url === next.url) return true;
  if (!previous.urlExpiresAt) return false;
  const expiresAt = Date.parse(previous.urlExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > refreshLeadMs;
}

export async function preloadRemoteImages(urls: Array<string | null | undefined>): Promise<void> {
  const uniqueUrls = [...new Set(urls.filter((url): url is string => Boolean(url)))];
  if (!uniqueUrls.length) return;
  await Promise.all(uniqueUrls.map((url) => preloadWithTimeout(url)));
}

export async function stabilizeSignedImage(
  previous: SignedImageUrl | null | undefined,
  next: SignedImageUrl,
  refreshLeadMs: number,
): Promise<SignedImageUrl> {
  const identity = getRemoteImageIdentity(next.url);
  const remembered = signedUrlMemoryCache.get(identity);
  if (previous?.url === next.url || remembered?.url === next.url) {
    rememberSignedImage(identity, next);
    return next;
  }
  const reusable = canKeepSignedImage(previous, next, refreshLeadMs)
    ? previous
    : canKeepSignedImage(remembered, next, refreshLeadMs)
      ? remembered
      : null;
  if (reusable) {
    rememberSignedImage(identity, reusable);
    return reusable;
  }
  if ((previous?.url || remembered?.url) && previous?.url !== next.url && remembered?.url !== next.url) {
    await preloadRemoteImages([next.url]);
  }
  rememberSignedImage(identity, next);
  return next;
}

export async function stabilizeProfileAvatar(
  previous: UserProfile | null | undefined,
  next: UserProfile,
  refreshLeadMs = 5 * 60_000,
): Promise<UserProfile> {
  if (!next.avatar) return next;
  const previousExpiry = previous?.avatar?.urlExpiresAt;
  const nextExpiry = next.avatar.urlExpiresAt;
  const [thumbnail, fullImage] = await Promise.all([
    stabilizeSignedImage(
      previous?.avatar ? { url: previous.avatar.thumbnailUrl, urlExpiresAt: previousExpiry } : null,
      { url: next.avatar.thumbnailUrl, urlExpiresAt: nextExpiry },
      refreshLeadMs,
    ),
    stabilizeSignedImage(
      previous?.avatar ? { url: previous.avatar.url, urlExpiresAt: previousExpiry } : null,
      { url: next.avatar.url, urlExpiresAt: nextExpiry },
      refreshLeadMs,
    ),
  ]);
  return {
    ...next,
    avatar: {
      ...next.avatar,
      thumbnailUrl: thumbnail.url,
      url: fullImage.url,
      urlExpiresAt: earliestExpiry(thumbnail.urlExpiresAt, fullImage.urlExpiresAt) ?? nextExpiry,
    },
  };
}

function rememberSignedImage(identity: string, image: SignedImageUrl): void {
  signedUrlMemoryCache.delete(identity);
  signedUrlMemoryCache.set(identity, image);
  while (signedUrlMemoryCache.size > MAX_MEMORY_ENTRIES) {
    const oldest = signedUrlMemoryCache.keys().next().value;
    if (typeof oldest !== "string") break;
    signedUrlMemoryCache.delete(oldest);
  }
}

function earliestExpiry(first?: string | null, second?: string | null): string | null {
  const values = [first, second]
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

async function preloadWithTimeout(url: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      Image.prefetch(url).catch(() => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), IMAGE_PRELOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
