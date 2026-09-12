const SESSION_KEY = "lf_web_session_v1";

function resolveApiBase() {
  const configured = document.querySelector('meta[name="lf-api-base"]')?.content?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "/api";
  return "https://api.yueyantech.com";
}

const API_BASE = resolveApiBase();
let refreshInFlight = null;

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function getStoredSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (!value?.accessToken || !value?.refreshToken || !value?.user?.id) return null;
    return value;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent("oio:session-changed"));
}

function storeLoginResult(result) {
  const session = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("oio:session-changed"));
  return session;
}

async function readResult(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ApiError("NON_JSON_RESPONSE", "服务暂时不可用，请稍后再试", response.status);
  }
  if (!response.ok || !result?.ok) {
    throw new ApiError(
      result?.error?.code ?? "REQUEST_FAILED",
      result?.error?.message ?? "请求失败，请稍后再试",
      response.status,
    );
  }
  return result.data;
}

async function rawRequest(path, init = {}) {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "无法连接服务器，请检查网络后重试", 0);
  }
}

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performSessionRefresh();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function performSessionRefresh() {
  const current = getStoredSession();
  if (!current) throw new ApiError("UNAUTHORIZED", "登录已失效，请重新登录", 401);
  const response = await rawRequest("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  const refreshed = await readResult(response);
  const next = { ...current, ...refreshed };
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}

async function authorizedRequest(path, init = {}, allowRefresh = true) {
  const session = getStoredSession();
  if (!session) throw new ApiError("UNAUTHORIZED", "请先登录", 401);
  const response = await rawRequest(path, {
    ...init,
    headers: { Authorization: `Bearer ${session.accessToken}`, ...init.headers },
  });
  if (response.status === 401 && allowRefresh) {
    try {
      const next = await refreshSession();
      const retry = await rawRequest(path, {
        ...init,
        headers: { Authorization: `Bearer ${next.accessToken}`, ...init.headers },
      });
      return readResult(retry);
    } catch (error) {
      clearStoredSession();
      throw error;
    }
  }
  try {
    return await readResult(response);
  } catch (error) {
    if (isTerminalSessionError(error)) clearStoredSession();
    throw error;
  }
}

function isTerminalSessionError(error) {
  return error instanceof ApiError
    && (error.code === "ACCOUNT_DISABLED" || error.code === "ACCOUNT_PENDING_DELETE");
}

export async function sendPasscode(credential) {
  const response = await rawRequest("/auth/authing-passcode/send", {
    method: "POST",
    body: JSON.stringify(credential),
  });
  return readResult(response);
}

export async function loginWithPasscode(input) {
  const response = await rawRequest("/auth/authing-passcode/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return storeLoginResult(await readResult(response));
}

export async function loginWithPassword(input) {
  const response = await rawRequest("/auth/authing-password/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return storeLoginResult(await readResult(response));
}

export function getProfile() {
  return authorizedRequest("/me/profile");
}

export function getBindings() {
  return authorizedRequest("/me/bindings");
}

export function updateProfileNickname(nickname) {
  return authorizedRequest("/me/profile/nickname", {
    method: "PUT",
    body: JSON.stringify({ nickname }),
  });
}

export function createAvatarUpload(input) {
  return authorizedRequest("/me/avatar-uploads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeAvatarUpload(uploadId) {
  return authorizedRequest(`/me/avatar-uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    body: "{}",
  });
}

export function removeProfileAvatar() {
  return authorizedRequest("/me/avatar", { method: "DELETE" });
}

export function getEntitlement() {
  return authorizedRequest("/me/entitlement");
}

export async function logout() {
  const session = getStoredSession();
  if (session) {
    try {
      const response = await rawRequest("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      await readResult(response);
    } catch {
      // Local logout must still succeed when the API is temporarily unavailable.
    }
  }
  clearStoredSession();
}
