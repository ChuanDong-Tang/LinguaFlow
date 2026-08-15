import type {
  AuthingLoginRequestBody,
  AuthingPasscodeLoginRequestBody,
  AuthingPasswordLoginRequestBody,
  ConfirmBindEmailRequestBody,
  ConfirmDeleteAccountRequestBody,
  LoginCredential,
  PrepareBindEmailRequestBody,
  PrepareDeleteAccountRequestBody,
  RefreshTokenRequestBody,
  SendAuthingPasscodeRequestBody,
} from "@lf/core/contracts/auth.js";

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

/** 运行时校验：确保请求体符合 Authing 登录落库接口 */
export function isAuthingLoginBody(value: unknown): value is AuthingLoginRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.authingToken === "string" && v.authingToken.trim().length > 0;
}

export function isSendAuthingPasscodeBody(value: unknown): value is SendAuthingPasscodeRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.channel === "phone") {
    return (
      typeof v.phone === "string" &&
      /^\d{6,20}$/.test(v.phone.trim()) &&
      typeof v.phoneCountryCode === "string" &&
      /^\+\d{1,4}$/.test(v.phoneCountryCode.trim())
    );
  }
  if (v.channel === "email") {
    return typeof v.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim());
  }
  return false;
}

export function isAuthingPasscodeLoginBody(value: unknown): value is AuthingPasscodeLoginRequestBody {
  if (!isSendAuthingPasscodeBody(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  return typeof v.passCode === "string" && /^\d{4,8}$/.test(v.passCode.trim());
}

export function isAuthingPasswordLoginBody(value: unknown): value is AuthingPasswordLoginRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.account === "string" &&
    v.account.trim().length > 0 &&
    v.account.trim().length <= 160 &&
    typeof v.password === "string" &&
    v.password.length > 0 &&
    v.password.length <= 256
  );
}

export function isRefreshTokenBody(value: unknown): value is RefreshTokenRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.refreshToken === "string" && v.refreshToken.trim().length > 0;
}

export function isPrepareDeleteAccountBody(value: unknown): value is PrepareDeleteAccountRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.authingToken === "string" && v.authingToken.trim().length > 0;
}

export function isConfirmDeleteAccountBody(value: unknown): value is ConfirmDeleteAccountRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.authingToken === "string" &&
    v.authingToken.trim().length > 0 &&
    (v.method === "PHONE_PASSCODE" || v.method === "EMAIL_PASSCODE") &&
    typeof v.passCode === "string" &&
    v.passCode.trim().length > 0
  );
}

export function isPrepareBindEmailBody(value: unknown): value is PrepareBindEmailRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.authingToken === "string" &&
    v.authingToken.trim().length > 0 &&
    typeof v.email === "string" &&
    v.email.trim().length > 0
  );
}

export function isConfirmBindEmailBody(value: unknown): value is ConfirmBindEmailRequestBody {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.authingToken === "string" &&
    v.authingToken.trim().length > 0 &&
    typeof v.email === "string" &&
    v.email.trim().length > 0 &&
    typeof v.passCode === "string" &&
    v.passCode.trim().length > 0
  );
}
