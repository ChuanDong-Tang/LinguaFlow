import { Image } from "react-native";
import { File, Paths } from "expo-file-system";
import { parseVideoUrl, type VideoLink } from "@lf/core/text/videoLink";

// Look up a YouTube / Bilibili video's title and cover from the device. The
// cover is attached to the memory as a normal photo, so it goes through the
// usual upload + moderation pipeline. Any failure leaves a plain link.

export type VideoLinkPreview = VideoLink & { title: string | null; cover: { uri: string; width: number; height: number } | null };

const TIMEOUT_MS = 8000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** b23.tv short links redirect to the real BV page. */
async function resolveShortLink(link: VideoLink): Promise<VideoLink> {
  if (link.provider !== "bilibili" || link.id.startsWith("BV")) return link;
  try {
    const response = await fetch(link.url, { method: "GET" });
    return parseVideoUrl(response.url) ?? link;
  } catch {
    return link;
  }
}

async function downloadCover(url: string, id: string): Promise<VideoLinkPreview["cover"]> {
  try {
    const secureUrl = url.replace(/^http:\/\//u, "https://");
    const file = new File(Paths.cache, `video-cover-${id}.jpg`);
    if (file.exists) file.delete();
    const downloaded = await File.downloadFileAsync(secureUrl, file);
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(downloaded.uri, (width, height) => resolve({ width, height }), reject);
    });
    return { uri: downloaded.uri, ...size };
  } catch {
    return null;
  }
}

export async function previewVideoLink(raw: string): Promise<VideoLinkPreview | null> {
  const parsed = parseVideoUrl(raw.trim());
  if (!parsed) return null;
  const link = await resolveShortLink(parsed);
  let title: string | null = null;
  let coverUrl: string | null = null;
  try {
    if (link.provider === "youtube") {
      const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`) as { title?: unknown; thumbnail_url?: unknown };
      title = typeof data.title === "string" ? data.title : null;
      coverUrl = `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg`;
    } else if (link.id.startsWith("BV")) {
      const data = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(link.id)}`) as { data?: { title?: unknown; pic?: unknown } };
      title = typeof data.data?.title === "string" ? data.data.title : null;
      coverUrl = typeof data.data?.pic === "string" ? data.data.pic : null;
    }
  } catch {
    // Title lookup is best-effort (YouTube is unreachable on many networks).
  }
  const cover = coverUrl ? await downloadCover(coverUrl, link.id) : null;
  return { ...link, title, cover };
}
