// Video links a memory can be attached to (2026-11: YouTube and Bilibili only).
// Shared by the app (detect + preview) and the server (validate before saving).

export type VideoLinkProvider = "youtube" | "bilibili";
export type VideoLink = { provider: VideoLinkProvider; id: string; url: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const BILIBILI_BV = /^BV[0-9A-Za-z]{10}$/;

/** Find the first supported video link in free text (or a bare URL). */
export function parseVideoLink(input: string): VideoLink | null {
  const candidates = input.match(/https?:\/\/[\x21-\x7E]+/gu) ?? [];
  for (const candidate of candidates) {
    const link = parseVideoUrl(candidate.replace(/[),.;!?。，）]+$/u, ""));
    if (link) return link;
  }
  return null;
}

export function parseVideoUrl(raw: string): VideoLink | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./u, "");
  if (host === "youtube.com") {
    const id = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/u)?.[1] ?? null;
    return id && YOUTUBE_ID.test(id) ? { provider: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === "bilibili.com") {
    const id = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})/u)?.[1] ?? null;
    return id && BILIBILI_BV.test(id) ? { provider: "bilibili", id, url: `https://www.bilibili.com/video/${id}` } : null;
  }
  if (host === "b23.tv") {
    // Short links need a redirect to resolve; keep them as-is.
    const code = url.pathname.slice(1).split("/")[0] ?? "";
    return /^[0-9A-Za-z]{4,16}$/u.test(code) ? { provider: "bilibili", id: code, url: `https://b23.tv/${code}` } : null;
  }
  return null;
}

/** In-app player URL (official embeds); null when the link can't be embedded (e.g. unresolved b23.tv). */
export function videoEmbedUrl(raw: string): string | null {
  const link = parseVideoUrl(raw);
  if (!link) return null;
  if (link.provider === "youtube") return `https://www.youtube-nocookie.com/embed/${link.id}?playsinline=1&autoplay=1&rel=0`;
  return link.id.startsWith("BV") ? `https://player.bilibili.com/player.html?bvid=${link.id}&autoplay=1&high_quality=1&danmaku=0` : null;
}
