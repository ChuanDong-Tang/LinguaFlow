import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "../../../../packages/core/src/types";

export type AuthSession = {
  token: string;
  user: User;
  sessionFlags?: {
    isPro: boolean;
  };
};

const SESSION_KEY = "lf_auth_session";

/** 保存登录会话：后续真登录也直接复用 */
export async function setSession(session: AuthSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** 读取登录会话：用于 App 启动自动登录 */
export async function getSession(): Promise<AuthSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    await AsyncStorage.removeItem(SESSION_KEY);
    return null;
  }
}

/** 清理登录会话：退出登录时调用 */
export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}
