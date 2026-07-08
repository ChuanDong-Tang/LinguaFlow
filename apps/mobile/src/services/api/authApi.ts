import type {
  AuthingLoginRequestBody,
  BindEmailResponse,
  ConfirmBindEmailRequestBody,
  ConfirmDeleteAccountRequestBody,
  DeleteAccountResponse,
  AuthingLoginResponse,
  LoginCredential,
  LoginResponse,
  LogoutRequestBody,
  PrepareBindEmailRequestBody,
  PrepareBindEmailResponse,
  PrepareDeleteAccountRequestBody,
  PrepareDeleteAccountResponse,
  RefreshTokenRequestBody,
  RefreshTokenResponse,
  TestPasswordLoginRequestBody,
} from "@lf/core/contracts/auth";
import { logEvent } from "../logger";
import { getAuthHeaders } from "../auth/authHeaders";

// 登录接口返回外层结构
type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const NON_JSON_RESPONSE_MESSAGE = "服务暂时不可用，请稍后再试";

export async function login(input: LoginCredential): Promise<LoginResponse> {
  // 记录发起登录（不记录验证码和 token）
  await logEvent("login_request", "info", undefined, { type: input.type });

  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });

    const apiResult = await readApiResult<LoginResponse>(res);

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
    const res = await fetch(`${BASE_URL}/auth/authing-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const apiResult = await readApiResult<AuthingLoginResponse>(res);

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
    const apiResult = await readApiResult<AuthingLoginResponse>(res);

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

  const apiResult = await readApiResult<RefreshTokenResponse>(res);
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

  const apiResult = await readApiResult<{ ok: true }>(res);
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
}

export async function prepareDeleteAccount(input: PrepareDeleteAccountRequestBody): Promise<PrepareDeleteAccountResponse> {
  const res = await fetch(`${BASE_URL}/auth/delete-account/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });

  const apiResult = await readApiResult<PrepareDeleteAccountResponse>(res);
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
  return apiResult.data;
}

export async function confirmDeleteAccount(input: ConfirmDeleteAccountRequestBody): Promise<DeleteAccountResponse> {
  const res = await fetch(`${BASE_URL}/auth/delete-account/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });

  const apiResult = await readApiResult<DeleteAccountResponse>(res);
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
  return apiResult.data;
}

export async function prepareBindEmail(input: PrepareBindEmailRequestBody): Promise<PrepareBindEmailResponse> {
  const res = await fetch(`${BASE_URL}/auth/bind-email/prepare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });

  const apiResult = await readApiResult<PrepareBindEmailResponse>(res);
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
  return apiResult.data;
}

export async function confirmBindEmail(input: ConfirmBindEmailRequestBody): Promise<BindEmailResponse> {
  const res = await fetch(`${BASE_URL}/auth/bind-email/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(input),
  });

  const apiResult = await readApiResult<BindEmailResponse>(res);
  if (!apiResult.ok) {
    throw new Error(apiResult.error.message);
  }
  return apiResult.data;
}

async function readApiResult<T>(res: Response): Promise<ApiResult<T>> {
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();

  if (!contentType.toLowerCase().includes("application/json")) {
    const preview = raw.trim().slice(0, 80);
    console.warn("[authApi] non-json response", {
      status: res.status,
      contentType,
      preview,
    });
    return {
      ok: false,
      error: {
        code: "NON_JSON_RESPONSE",
        message: NON_JSON_RESPONSE_MESSAGE,
      },
    };
  }

  try {
    return JSON.parse(raw) as ApiResult<T>;
  } catch (error) {
    console.warn("[authApi] invalid json response", {
      status: res.status,
      contentType,
      error,
    });
    return {
      ok: false,
      error: {
        code: "INVALID_JSON_RESPONSE",
        message: NON_JSON_RESPONSE_MESSAGE,
      },
    };
  }
}
