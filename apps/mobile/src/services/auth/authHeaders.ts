import { clearSession, getSession, setSession } from "./authStorage";
import { clearAccountScopedStorage } from "./accountScopedStorage";
import { refreshAccessToken } from "../api/authApi";
import { emitSessionInvalid } from "./authSessionEvents";

const REFRESH_AHEAD_SECONDS = 60;
let refreshingPromise: Promise<void> | null = null;

export async function getAuthHeaders(): Promise<Record<string, string>> {
  await ensureFreshSession();
  const session = await getSession();

  if (session?.accessToken) {
    return {
      Authorization: `Bearer ${session.accessToken}`,
    };
  }

  return {};
}

async function ensureFreshSession(): Promise<void> {
  if (refreshingPromise) {
    await refreshingPromise;
    return;
  }

  const session = await getSession();
  if (!session?.accessToken || !session.refreshToken) return;

  const payload = decodeJwtPayload(session.accessToken);
  if (!payload?.exp) return;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp - now > REFRESH_AHEAD_SECONDS) return;

  refreshingPromise = (async () => {
    try {
      const refreshed = await refreshAccessToken({ refreshToken: session.refreshToken! });
      await setSession({
        ...session,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      });
    } catch {
      await clearSession();
      await clearAccountScopedStorage();
      emitSessionInvalid();
    } finally {
      refreshingPromise = null;
    }
  })();

  await refreshingPromise;
}

function decodeJwtPayload(token: string): { exp?: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const base64 = `${normalized}${padding}`;
    const json = globalThis.atob(base64);
    return JSON.parse(json) as { exp?: number };
  } catch {
    return null;
  }
}
