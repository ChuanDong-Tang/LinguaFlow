import { getAccessRepository } from "../../infrastructure/repositories";
import { getAuthService } from "../auth/authService";
import { saveCaptureRecord } from "../../modules/dailyCapture/dailyCaptureStore";
import { listChatSessions, overwriteChatSessions } from "../../modules/oioChat/oioChatStore";
import { type DailyCaptureRecord } from "../../domain/capture";
import { type OioChatSession } from "../../modules/oioChat/oioChatStore";

const SYNC_ACCESS_CACHE_MS = 60_000;
const CLOUD_SYNC_TIMEOUT_MS = 12_000;
const CHAT_PAGE_SIZE = 50;
let cachedCanSync: { actorKey: string; value: boolean; expiresAt: number } | null = null;
let canSyncInFlight: Promise<boolean> | null = null;
let canSyncInFlightActorKey = "";

function isPersistableSession(session: OioChatSession): boolean {
  return session.kind !== "practice";
}

function getSyncActorKey(): string {
  return getAuthService().getSnapshot().userId ?? "anonymous";
}

function clearSyncAccessCache(): void {
  cachedCanSync = null;
}

async function canSync(): Promise<boolean> {
  const actorKey = getSyncActorKey();
  const now = Date.now();
  if (cachedCanSync && cachedCanSync.actorKey === actorKey && cachedCanSync.expiresAt > now) {
    return cachedCanSync.value;
  }
  if (canSyncInFlight && canSyncInFlightActorKey === actorKey) {
    return canSyncInFlight;
  }
  canSyncInFlightActorKey = actorKey;
  canSyncInFlight = (async () => {
    const access = await getAccessRepository().getViewerAccess();
    return access.entitlements.some((item) => item.active);
  })();
  try {
    const result = await canSyncInFlight;
    cachedCanSync = { actorKey, value: result, expiresAt: Date.now() + SYNC_ACCESS_CACHE_MS };
    return result;
  } catch {
    // Do not cache failures, so transient /api/me errors won't block sync for 60s.
    return false;
  } finally {
    canSyncInFlight = null;
    canSyncInFlightActorKey = "";
  }
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const token = await getAuthService().getSessionToken();
  const headers = new Headers(options?.headers ?? {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CLOUD_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearSyncAccessCache();
      }
      throw new Error(`Cloud sync failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Cloud sync timeout");
    }
    if (error instanceof Error && error.message.startsWith("Cloud sync failed:")) {
      throw error;
    }
    throw new Error("Cloud sync network error");
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function pullChatSessions(): Promise<{ sessions: OioChatSession[]; hasMore: boolean; nextBefore: string | null } | null> {
  if (!(await canSync())) return null;
  const payload = await fetchJson<{ sessions: OioChatSession[]; has_more?: boolean; next_before?: string | null }>(
    `/api/sync-chat?limit=${CHAT_PAGE_SIZE}`,
  );
  const remote = Array.isArray(payload.sessions) ? payload.sessions.filter(isPersistableSession) : [];
  const local = (await listChatSessions()).filter(isPersistableSession);
  if (!remote.length) {
    if (local.length > 0) {
      await fetchJson("/api/sync-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: local }),
      });
      return { sessions: local, hasMore: false, nextBefore: null };
    }
    return { sessions: [], hasMore: false, nextBefore: null };
  }

  const merged = mergeChatSessions(local, remote);
  await overwriteChatSessions(merged);
  return {
    sessions: merged,
    hasMore: payload.has_more === true,
    nextBefore: typeof payload.next_before === "string" && payload.next_before.trim() ? payload.next_before : null,
  };
}

export interface ChatPageResult {
  hasMore: boolean;
  nextBefore: string | null;
}

export async function pullMoreChatSessions(before: string): Promise<ChatPageResult | null> {
  if (!(await canSync())) return null;
  if (!before?.trim()) return null;
  const payload = await fetchJson<{ sessions: OioChatSession[]; has_more?: boolean; next_before?: string | null }>(
    `/api/sync-chat?limit=${CHAT_PAGE_SIZE}&before=${encodeURIComponent(before)}`,
  );
  const remote = Array.isArray(payload.sessions) ? payload.sessions.filter(isPersistableSession) : [];
  const local = (await listChatSessions()).filter(isPersistableSession);
  const merged = mergeChatSessions(local, remote);
  await overwriteChatSessions(merged);
  return {
    hasMore: payload.has_more === true,
    nextBefore: typeof payload.next_before === "string" && payload.next_before.trim() ? payload.next_before : null,
  };
}

export async function pushChatSessions(sessions: OioChatSession[]): Promise<void> {
  if (!(await canSync())) return;
  const persistable = sessions.filter(isPersistableSession);
  try {
    await fetchJson("/api/sync-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: persistable }),
    });
  } catch {
    console.error("[sync-chat] pushChatSessions failed", Error, {
      sessionCount: persistable.length,
    });
  }
}

export async function deleteChatSessions(sessionIds: string[]): Promise<void> {
  if (!(await canSync())) return;
  const normalizedSessionIds = sessionIds
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  if (!normalizedSessionIds.length) return;
  try {
    await fetchJson<{ ok?: boolean }>("/api/sync-chat", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: normalizedSessionIds }),
    });
  } catch {
    // ignore cloud sync failures
  }
}

export interface ChatPhraseUpdatePayload {
  sessionId: string;
  turnId: string;
  keyPhrases: string[];
  clientVersion: number;
}

export async function pushChatPhraseUpdates(updates: ChatPhraseUpdatePayload[]): Promise<boolean> {
  const payload = updates
    .map((update) => ({
      sessionId: typeof update.sessionId === "string" ? update.sessionId.trim() : "",
      turnId: typeof update.turnId === "string" ? update.turnId.trim() : "",
      keyPhrases: Array.isArray(update.keyPhrases) ? update.keyPhrases.filter((item) => typeof item === "string") : [],
      clientVersion: Number.isFinite(update.clientVersion) ? Math.max(0, Math.floor(update.clientVersion)) : 0,
    }))
    .filter((update) => update.sessionId && update.turnId && update.clientVersion > 0);

  if (!payload.length) return true;
  if (!(await canSync())) return true;
  try {
    await fetchJson<{ ok?: boolean }>("/api/sync-chat-phrases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: payload }),
    });
    return true;
  } catch {
    return false;
  }
}

export interface CaptureDaySummary {
  dateKey: string;
  cardCount: number;
  updatedAt: string;
}

export async function pullCaptureIndex(): Promise<CaptureDaySummary[] | null> {
  if (!(await canSync())) return null;
  const payload = await fetchJson<{ index?: Array<{ dateKey?: string; cardCount?: number; updatedAt?: string }> }>(
    "/api/sync-capture?view=index",
  );
  const index = Array.isArray(payload.index) ? payload.index : [];
  return index
    .map((item) => ({
      dateKey: typeof item.dateKey === "string" ? item.dateKey : "",
      cardCount: Number(item.cardCount) || 0,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    }))
    .filter((item) => !!item.dateKey);
}

export async function pullCaptureRecordByDate(dateKey: string): Promise<DailyCaptureRecord | null> {
  if (!(await canSync())) return null;
  const normalizedDateKey = dateKey.trim();
  if (!normalizedDateKey) return null;
  const payload = await fetchJson<{ record?: DailyCaptureRecord | null }>(
    `/api/sync-capture?date=${encodeURIComponent(normalizedDateKey)}`,
  );
  const record = payload.record;
  if (!record || typeof record !== "object" || record.dateKey !== normalizedDateKey) {
    return null;
  }
  await saveCaptureRecord(record);
  return record;
}

export async function pushCaptureRecord(record: DailyCaptureRecord): Promise<void> {
  try {
    if (!(await canSync())) return;
    await fetchJson("/api/sync-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record }),
    });
  } catch {
    // ignore cloud sync failures
  }
}

export async function deleteCaptureItems(captureIds: string[]): Promise<void> {
  if (!(await canSync())) return;
  const normalizedCaptureIds = captureIds
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  if (!normalizedCaptureIds.length) return;
  try {
    await fetchJson<{ ok?: boolean }>("/api/sync-capture", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureIds: normalizedCaptureIds }),
    });
  } catch {
    // ignore cloud sync failures
  }
}

// remote first
function mergeChatSessions(local: OioChatSession[], remote: OioChatSession[]): OioChatSession[] {
  const map = new Map<string, OioChatSession>();
  for (const session of local.filter(isPersistableSession)) {
    map.set(session.id, session);
  }
  for (const session of remote.filter(isPersistableSession)) {
    map.set(session.id, session);
  }
  return Array.from(map.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
