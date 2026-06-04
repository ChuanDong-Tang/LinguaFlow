import type {
  AuthingLoginRequestBody,
  AuthingLoginResponse,
  LoginCredential,
  LoginResponse,
  LogoutRequestBody,
  RefreshTokenRequestBody,
  RefreshTokenResponse,
  TestPasswordLoginRequestBody,
} from "@lf/core/contracts/auth";
import { logEvent } from "../logger";

// 登录接口返回外层结构
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export async function login(input: LoginCredential): Promise<LoginResponse> {
  // 记录发起登录（不记录验证码和 token）
  await logEvent("login_request", "info", undefined, { type: input.type });

  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });

    const apiResult = (await res.json()) as ApiResult<LoginResponse>;

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
    console.log("[authing-login] backend request", {
      baseUrl: BASE_URL,
      tokenLength: input.authingToken.length,
    });
    const res = await fetch(`${BASE_URL}/auth/authing-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const apiResult = (await res.json()) as ApiResult<AuthingLoginResponse>;
    console.log("[authing-login] backend response", {
      status: res.status,
      ok: apiResult.ok,
      errorCode: apiResult.ok ? undefined : apiResult.error.code,
      errorMessage: apiResult.ok ? undefined : apiResult.error.message,
    });

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
    console.warn("[authing-login] backend exception", {
      message: err instanceof Error ? err.message : String(err),
    });
    await logEvent(
      "authing_login_exception",
      "error",
      err instanceof Error ? err.message : "unknown error"
    );
    throw err;
  }
}

export async function loginWithTestPassword(input: TestPasswordLoginRequestBody): Promise<AuthingLoginResponse> {
  await logEvent("test_password_login_request", "info", undefined, { account: input.account });

  try {
    const res = await fetch(`${BASE_URL}/auth/test-password-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const apiResult = (await res.json()) as ApiResult<AuthingLoginResponse>;

    if (!apiResult.ok) {
      await logEvent("test_password_login_failed", "warn", apiResult.error.message, {
        code: apiResult.error.code,
        account: input.account,
      });
      throw new Error(apiResult.error.message);
    }

    await logEvent("test_password_login_success", "info", undefined, {
      userId: apiResult.data.user.id,
    });

    return apiResult.data;
  } catch (err) {
    await logEvent(
      "test_password_login_exception",
      "error",
      err instanceof Error ? err.message : "unknown error",
      { account: input.account }
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
