import { getAccessRepository } from "../../infrastructure/repositories";
import { getAuthService } from "../auth/authService";
import { listCaptureRecords, saveCaptureRecord } from "../../modules/dailyCapture/dailyCaptureStore";
import { listChatSessions, overwriteChatSessions } from "../../modules/oioChat/oioChatStore";
import { type DailyCaptureRecord } from "../../domain/capture";
import { type OioChatSession } from "../../modules/oioChat/oioChatStore";

const SYNC_ACCESS_CACHE_MS = 60_000;
const CLOUD_SYNC_TIMEOUT_MS = 12_000;
let cachedCanSync: { actorKey: string; value: boolean; expiresAt: number } | null = null;
let canSyncInFlight: Promise<boolean> | null = null;
let canSyncInFlightActorKey = "";

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
    return access.entitlements.some((item) => item.active && item.code === "pro_access");
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

export async function pullChatSessions(): Promise<OioChatSession[] | null> {
  const payload = await fetchJson<{ sessions: OioChatSession[] }>("/api/sync-chat");
  const remote = Array.isArray(payload.sessions) ? payload.sessions : [];
  const local = await listChatSessions();
  if (!remote.length) {
    if (local.length > 0) {
      await fetchJson("/api/sync-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: local }),
      });
      return local;
    }
    return [];
  }

  const merged = mergeChatSessions(local, remote);
  await overwriteChatSessions(merged);
  return merged;
}

export async function pushChatSessions(sessions: OioChatSession[]): Promise<void> {
  try {
    await fetchJson("/api/sync-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions }),
    });
  } catch {
    // ignore cloud sync failures
  }
}

export async function pullCaptureRecords(): Promise<DailyCaptureRecord[] | null> {
  if (!(await canSync())) return null;
  const payload = await fetchJson<{ records: DailyCaptureRecord[] }>("/api/sync-capture");
  const remote = Array.isArray(payload.records) ? payload.records : [];
  const local = await listCaptureRecords();
  if (!remote.length) {
    if (local.length > 0) {
      await fetchJson("/api/sync-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: local }),
      });
      return local;
    }
    return [];
  }

  const merged = mergeCaptureRecords(local, remote);
  for (const record of merged) {
    await saveCaptureRecord(record);
  }
  return merged;
}

export async function pushCaptureRecords(records: DailyCaptureRecord[]): Promise<void> {
  try {
    if (!(await canSync())) return;
    await fetchJson("/api/sync-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    });
  } catch {
    // ignore cloud sync failures
  }
}

function mergeChatSessions(local: OioChatSession[], remote: OioChatSession[]): OioChatSession[] {
  const map = new Map<string, OioChatSession>();
  for (const session of local) {
    map.set(session.id, session);
  }
  for (const session of remote) {
    const existing = map.get(session.id);
    if (!existing) {
      map.set(session.id, session);
      continue;
    }
    if (existing.updatedAt < session.updatedAt) {
      map.set(session.id, session);
    }
  }
  return Array.from(map.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function mergeCaptureRecords(local: DailyCaptureRecord[], remote: DailyCaptureRecord[]): DailyCaptureRecord[] {
  const map = new Map<string, DailyCaptureRecord>();
  for (const record of local) {
    map.set(record.dateKey, record);
  }
  for (const record of remote) {
    const existing = map.get(record.dateKey);
    if (!existing || existing.updatedAt < record.updatedAt) {
      map.set(record.dateKey, record);
    }
  }
  return Array.from(map.values()).sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}
