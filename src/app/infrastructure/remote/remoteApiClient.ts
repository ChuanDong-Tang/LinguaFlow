import { getAuthService } from "../../services/auth/authService";

export class RemoteApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RemoteApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

const DEFAULT_API_TIMEOUT_MS = 12_000;

export async function requestAppApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const authService = getAuthService();
  const token = await authService.getSessionToken();
  const headers = new Headers(init.headers ?? {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      ...init,
      headers,
      signal: controller.signal,
    });
    let payload: T | ErrorPayload | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const error = (payload as ErrorPayload | null)?.error;
      throw new RemoteApiError(response.status, error?.code || "REQUEST_FAILED", error?.message || "The request failed.");
    }

    return payload as T;
  } catch (error) {
    if (error instanceof RemoteApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RemoteApiError(0, "REQUEST_TIMEOUT", "The request timed out.");
    }
    throw new RemoteApiError(0, "NETWORK_ERROR", "Network connection failed.");
  } finally {
    window.clearTimeout(timeout);
  }
}
