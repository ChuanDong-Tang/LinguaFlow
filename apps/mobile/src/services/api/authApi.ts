import type {
  AuthingLoginRequestBody,
  AuthingLoginResponse,
  LoginCredential,
  LoginResponse,
  LogoutRequestBody,
  RefreshTokenRequestBody,
  RefreshTokenResponse,
} from "@lf/core/contracts/auth";
import { logEvent } from "../logger";

// 登录接口返回外层结构
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: (error as { cause?: unknown }).cause,
  };
}

async function readResponseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (error) {
    console.log("[auth-api-debug] read response failed", describeError(error));
    return "";
  }
}

export async function login(input: LoginCredential): Promise<LoginResponse> {
  // 记录发起登录（不记录验证码和 token）
  await logEvent("login_request", "info", undefined, { type: input.type });

  try {
    const url = `${BASE_URL}/auth/login`;
    console.log("[auth-api-debug] login fetch start", { url, baseUrl: BASE_URL, type: input.type });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const responseText = await readResponseText(res);
    console.log("[auth-api-debug] login fetch response", {
      url,
      status: res.status,
      ok: res.ok,
      body: responseText.slice(0, 500),
    });

    const apiResult = JSON.parse(responseText) as ApiResult<LoginResponse>;

    if (!apiResult.ok) {
      // 记录业务失败（例如参数不合法、验证码错误）
      await logEvent("login_failed", "warn", apiResult.error.message, {
        code: apiResult.error.code,
        type: input.type
      });
      throw new Error(apiResult.error.message);
    }

    // 记录登录成功
    await logEvent("login_success", "info", undefined, {
      userId: apiResult.data.user.id,
      type: input.type
    });

    return apiResult.data;
  } catch (err) {
    console.log("[auth-api-debug] login exception", {
      baseUrl: BASE_URL,
      type: input.type,
      error: describeError(err),
    });
    // 记录异常失败（网络中断、解析失败等）
    await logEvent(
      "login_exception",
      "error",
      err instanceof Error ? err.message : "unknown error",
      { type: input.type }
    );
    throw err;
  }
}

export async function loginWithAuthing(input: AuthingLoginRequestBody): Promise<AuthingLoginResponse> {
  await logEvent("authing_login_request", "info");

  try {
    const url = `${BASE_URL}/auth/authing-login`;
    console.log("[auth-api-debug] authing login fetch start", { url, baseUrl: BASE_URL });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const responseText = await readResponseText(res);
    console.log("[auth-api-debug] authing login fetch response", {
      url,
      status: res.status,
      ok: res.ok,
      body: responseText.slice(0, 500),
    });
    const apiResult = JSON.parse(responseText) as ApiResult<AuthingLoginResponse>;

    if (!apiResult.ok) {
      await logEvent("authing_login_failed", "warn", apiResult.error.message, {
        code: apiResult.error.code,
      });
      throw new Error(apiResult.error.message);
    }

    await logEvent("authing_login_success", "info", undefined, {
      userId: apiResult.data.user.id,
    });

    return apiResult.data;
  } catch (err) {
    console.log("[auth-api-debug] authing login exception", {
      baseUrl: BASE_URL,
      error: describeError(err),
    });
    await logEvent(
      "authing_login_exception",
      "error",
      err instanceof Error ? err.message : "unknown error"
    );
    throw err;
  }
}

export async function refreshAccessToken(input: RefreshTokenRequestBody): Promise<RefreshTokenResponse> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const apiResult = (await res.json()) as ApiResult<RefreshTokenResponse>;
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
  return apiResult.data;
}

export async function logout(input: LogoutRequestBody): Promise<void> {
  const res = await fetch(`${BASE_URL}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const apiResult = (await res.json()) as ApiResult<{ ok: true }>;
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
}
