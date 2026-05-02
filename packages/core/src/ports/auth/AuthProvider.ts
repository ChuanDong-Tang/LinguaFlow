import type { User } from "../../types/index.js";
import type { LoginCredential } from "../../contracts/auth.js";

export type AuthLoginByPhoneInput = {
  phone: string;
  code: string;
};

export type AuthLoginByWechatInput = {
  wechatCode: string;
};

export type AuthLoginResult = {
  token: string;
  user: User;
  sessionFlags?: {
    isPro: boolean;
  };
};

export interface AuthProvider {
  login(input: LoginCredential): Promise<AuthLoginResult>;
}

