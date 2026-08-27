import { clearSession, getSession, setSession } from "./authStorage";
import { clearAccountScopedStorage } from "./accountScopedStorage";
import { ApiError, refreshAccessToken } from "../api/authApi";
import { emitSessionInvalid } from "./authSessionEvents";

const REFRESH_AHEAD_SECONDS = 60;
let refreshingPromise: Promise<void> | null = null;

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const accessToken = await getAuthAccessToken();

  if (accessToken) {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  return {};
}

export async function getAuthAccessToken(): Promise<string | null> {
  await ensureFreshSession();
  const session = await getSession();
  return session?.accessToken ?? null;
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
    } catch (error) {
      // A refresh can fail because the API is temporarily unreachable (for
      // example on a slow cross-region connection). Keep the refresh token in
      // that case so a later request can retry instead of forcing a login.
      if (isTerminalRefreshError(error)) {
        await clearSession();
        await clearAccountScopedStorage();
        emitSessionInvalid();
      }
    } finally {
      refreshingPromise = null;
    }
  })();

  await refreshingPromise;
}

const TERMINAL_REFRESH_ERROR_CODES = new Set([
  "AUTH_INVALID",
  "ACCOUNT_DISABLED",
  "ACCOUNT_PENDING_DELETE",
]);

function isTerminalRefreshError(error: unknown): boolean {
  return error instanceof ApiError && TERMINAL_REFRESH_ERROR_CODES.has(error.code);
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
