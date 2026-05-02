import type { LoginCredential, LoginResponse } from "../../../../packages/core/src/contracts/auth";
import { logEvent } from "./logger";

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
