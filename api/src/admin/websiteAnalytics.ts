import { readFile } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);
const DEFAULT_LOG_PATH = "/var/log/nginx/oio-website-access.log";
const MAX_LOG_AGE_DAYS = 14;
const CACHE_TTL_MS = 60_000;
const PUBLIC_PAGES = new Map([
  ["/app.html", "App 首页"],
  ["/wiki/", "Wiki 首页"],
  ["/wiki/philosophy.html", "学习理念"],
  ["/wiki/card.html", "制作 Card"],
  ["/wiki/encounter.html", "再次遇见"],
  ["/wiki/download.html", "下载 OIO"],
  ["/wiki/contact.html", "加入群聊"],
]);

export interface WebsiteAnalyticsSummary {
  generatedAt: string;
  windowDays: number;
  pageViews: number;
  uniqueVisitors: number;
  downloads: { ios: number; android: number };
  topPages: Array<{ path: string; label: string; views: number }>;
  sources: Array<{ source: string; visits: number }>;
}

interface ParsedLogLine {
  ip: string;
  timestamp: number;
  method: string;
  requestTarget: string;
  status: number;
  referrer: string;
  userAgent: string;
}

const cache = new Map<number, { expiresAt: number; value: WebsiteAnalyticsSummary }>();

export async function getWebsiteAnalytics(requestedDays: unknown): Promise<WebsiteAnalyticsSummary> {
  const days = normalizeDays(requestedDays);
  const cached = cache.get(days);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const logPath = process.env.LF_WEBSITE_ACCESS_LOG_PATH?.trim() || DEFAULT_LOG_PATH;
  const contents = await readLogFiles(logPath);
  const value = summarizeWebsiteAccessLogs(contents, days);
  cache.set(days, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export function summarizeWebsiteAccessLogs(contents: string[], days: number, now = Date.now()): WebsiteAnalyticsSummary {
  const since = now - days * 86_400_000;
  const visitors = new Set<string>();
  const pageCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const downloads = { ios: 0, android: 0 };
  let pageViews = 0;

  for (const content of contents) {
    for (const line of content.split("\n")) {
      const entry = parseCombinedLogLine(line);
      if (!entry || entry.timestamp < since || entry.timestamp > now + 300_000) continue;
      if (entry.method !== "GET" || entry.status < 200 || entry.status >= 400 || isBot(entry.userAgent)) continue;

      const requestUrl = safeRequestUrl(entry.requestTarget);
      if (!requestUrl) continue;
      const metric = requestUrl.searchParams.get("oio_event");
      if (metric === "download_ios") downloads.ios += 1;
      if (metric === "download_android") downloads.android += 1;

      const pagePath = normalizePublicPage(requestUrl.pathname);
      if (!pagePath) continue;
      pageViews += 1;
      visitors.add(entry.ip);
      pageCounts.set(pagePath, (pageCounts.get(pagePath) ?? 0) + 1);

      const source = normalizeSource(requestUrl.searchParams.get("utm_source"), entry.referrer);
      if (source) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays: days,
    pageViews,
    uniqueVisitors: visitors.size,
    downloads,
    topPages: [...pageCounts.entries()]
      .map(([path, views]) => ({ path, label: PUBLIC_PAGES.get(path) ?? path, views }))
      .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
      .slice(0, 12),
    sources: [...sourceCounts.entries()]
      .map(([source, visits]) => ({ source, visits }))
      .sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source))
      .slice(0, 12),
  };
}

function normalizeDays(value: unknown): number {
  const days = Number(value ?? 7);
  if (!Number.isFinite(days)) return 7;
  return [1, 7, 14].includes(Math.floor(days)) ? Math.floor(days) : 7;
}

async function readLogFiles(basePath: string): Promise<string[]> {
  const paths = [basePath, `${basePath}.1`, ...Array.from({ length: MAX_LOG_AGE_DAYS - 1 }, (_, index) => `${basePath}.${index + 2}.gz`)];
  const files = await Promise.all(paths.map(async (path) => {
    try {
      const buffer = await readFile(path);
      return path.endsWith(".gz") ? (await gunzipAsync(buffer)).toString("utf8") : buffer.toString("utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }));
  const contents = files.filter((value): value is string => value !== null);
  if (contents.length === 0) throw new Error(`Website access log is unavailable: ${basePath}`);
  return contents;
}

function parseCombinedLogLine(line: string): ParsedLogLine | null {
  const match = line.match(/^(\S+) \S+ \S+ \[([^\]]+)] "(\S+) ([^ ]+) [^"]+" (\d{3}) \S+ "([^"]*)" "([^"]*)"/);
  if (!match) return null;
  const timestamp = parseNginxTimestamp(match[2]);
  if (!Number.isFinite(timestamp)) return null;
  return {
    ip: match[1],
    timestamp,
    method: match[3],
    requestTarget: match[4],
    status: Number(match[5]),
    referrer: match[6],
    userAgent: match[7],
  };
}

function parseNginxTimestamp(value: string): number {
  const match = value.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!match) return Number.NaN;
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const month = months[match[2]];
  if (month === undefined) return Number.NaN;
  const localUtc = Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
  const offset = (Number(match[8]) * 60 + Number(match[9])) * 60_000;
  return match[7] === "+" ? localUtc - offset : localUtc + offset;
}

function safeRequestUrl(target: string): URL | null {
  try {
    return new URL(target, "https://yueyantech.com");
  } catch {
    return null;
  }
}

function normalizePublicPage(path: string): string | null {
  if (path === "/" || path === "/index.html") return "/app.html";
  if (path === "/wiki" || path === "/wiki/index.html") return "/wiki/";
  return PUBLIC_PAGES.has(path) ? path : null;
}

function normalizeSource(utmSource: string | null, referrer: string): string | null {
  if (utmSource?.trim()) return `utm:${utmSource.trim().toLocaleLowerCase().slice(0, 80)}`;
  if (!referrer || referrer === "-") return null;
  try {
    const hostname = new URL(referrer).hostname.toLocaleLowerCase();
    if (!hostname || hostname === "yueyantech.com" || hostname.endsWith(".yueyantech.com")) return null;
    if (/^\d+(\.\d+){3}$/.test(hostname)) return null;
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

function isBot(userAgent: string): boolean {
  return /(bot|spider|crawler|slurp|headless|preview)/i.test(userAgent);
}
