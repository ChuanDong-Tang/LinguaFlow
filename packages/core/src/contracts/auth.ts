import type { User } from "../types";

export type LoginRequest =
  | { type: "phone"; phone: string; code: string }
  | { type: "wechat"; wechatCode: string };

export type LoginResponse = {
  token: string;
  user: User;
  sessionFlags?: {
    isPro: boolean;
  };
}

export type LoginCredential =
  | { type: "phone_code"; phone: string; code: string }
  | { type: "wechat_code"; wechatCode: string }
  | { type: "email_code"; email: string; code: string };

/** 微信登录（落库链路）请求体 */
export interface WeChatLoginRequestBody {
  authingToken: string;
}

/** 微信登录（落库链路）响应体 */
export interface WeChatLoginResponse {
  accessToken: string;
  user: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    status: "active" | "disabled";
    createdAt: Date;
    updatedAt: Date;
  };
  isNewUser: boolean;
}
