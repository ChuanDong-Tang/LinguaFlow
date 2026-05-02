import type { LoginCredential, WeChatLoginRequestBody } from "@lf/core/contracts/auth";

/** 运行时校验：确保请求体符合 LoginCredential */
export function isLoginRequest(value: unknown): value is LoginCredential {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (v.type === "phone_code") {
    return typeof v.phone === "string" && typeof v.code === "string";
  }
  if (v.type === "wechat_code") {
    return typeof v.wechatCode === "string";
  }
  if (v.type === "email_code") {
    return typeof v.email === "string" && typeof v.code === "string";
  }
  return false;
}

/** 运行时校验：确保请求体符合微信登录落库接口 */
export function isWeChatLoginBody(value: unknown): value is WeChatLoginRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.authingToken === "string" && v.authingToken.trim().length > 0;
}
