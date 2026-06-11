import type { User } from "../types/index.js";

export type LoginRequest =
  | { type: "phone"; phone: string; code: string }
  | { type: "wechat"; wechatCode: string };

export type LoginResponse = {
  token: string;
  refreshToken?: string;
  user: User;
  sessionFlags?: {
    isPro: boolean;
  };
}

export type LoginCredential =
  | { type: "phone_code"; phone: string; code: string }
  | { type: "wechat_code"; wechatCode: string }
  | { type: "email_code"; email: string; code: string };

/** Authing 登录（落库链路）请求体 */
export interface AuthingLoginRequestBody {
  authingToken: string;
}

/** 测试环境临时账号登录请求体 */
export interface TestPasswordLoginRequestBody {
  account: string;
  password: string;
}

/** Authing 登录（落库链路）响应体 */
export interface AuthingLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    nickname: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    role: "user" | "admin";
    status: "active" | "disabled" | "pending_delete";
    createdAt: Date;
    updatedAt: Date;
  };
  isNewUser: boolean;
}

export interface RefreshTokenRequestBody {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface LogoutRequestBody {
  refreshToken: string;
}

export interface LogoutResponse {
  ok: true;
}

export type DeleteAccountVerifyMethod = "PHONE_PASSCODE" | "EMAIL_PASSCODE";

export interface PrepareDeleteAccountRequestBody {
  authingToken: string;
}

export interface PrepareDeleteAccountResponse {
  authingToken: string;
  method: DeleteAccountVerifyMethod;
  target: string;
}

export interface ConfirmDeleteAccountRequestBody {
  authingToken: string;
  method: DeleteAccountVerifyMethod;
  passCode: string;
}

export interface DeleteAccountResponse {
  success: true;
}
