import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { User } from "@lf/core/types";
import { environmentStorageKey } from "../storage/environmentStorageKey";

export type AuthSession = {
  accessToken: string;
  refreshToken?: string;
  user: User;
  sessionFlags?: {
    isPro: boolean;
  };
};

const SESSION_KEY = environmentStorageKey("lf_auth_session");
const FORCE_AUTHING_LOGIN_KEY = environmentStorageKey("lf_force_authing_login");

/** 保存登录会话：后续真登录也直接复用 */
export async function setSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

/** 读取登录会话：用于 App 启动自动登录 */
export async function getSession(): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

/** 清理登录会话：退出登录时调用 */
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function markForceAuthingLogin(): Promise<void> {
  await AsyncStorage.setItem(FORCE_AUTHING_LOGIN_KEY, "1");
}

export async function shouldForceAuthingLogin(): Promise<boolean> {
  const value = await AsyncStorage.getItem(FORCE_AUTHING_LOGIN_KEY);
  return Boolean(value);
}

export async function clearForceAuthingLogin(): Promise<void> {
  await AsyncStorage.removeItem(FORCE_AUTHING_LOGIN_KEY);
}
