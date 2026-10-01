import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { User } from "@lf/core/types";
import { environmentStorageKey } from "../storage/environmentStorageKey";
import { shouldUseIosSimulatorAuthStorage } from "./authStoragePolicy";

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
const AUTHING_ACCESS_TOKEN_KEY = environmentStorageKey("lf_authing_access_token");

let useSimulatorStoragePromise: Promise<boolean> | null = null;

async function useSimulatorStorage(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  useSimulatorStoragePromise ??= Application.getIosApplicationReleaseTypeAsync()
    .then((releaseType) => shouldUseIosSimulatorAuthStorage(
      Platform.OS,
      releaseType === Application.ApplicationReleaseType.SIMULATOR,
    ))
    .catch(() => false);
  return useSimulatorStoragePromise;
}

async function setAuthValue(key: string, value: string): Promise<void> {
  if (await useSimulatorStorage()) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getAuthValue(key: string): Promise<string | null> {
  if (await useSimulatorStorage()) return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function removeAuthValue(key: string): Promise<void> {
  if (await useSimulatorStorage()) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** 保存登录会话：后续真登录也直接复用 */
export async function setSession(session: AuthSession): Promise<void> {
  await setAuthValue(SESSION_KEY, JSON.stringify(session));
}

/** 读取登录会话：用于 App 启动自动登录 */
export async function getSession(): Promise<AuthSession | null> {
  const raw = await getAuthValue(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    await removeAuthValue(SESSION_KEY);
    return null;
  }
}

/** 清理登录会话：退出登录时调用 */
export async function clearSession(): Promise<void> {
  await removeAuthValue(SESSION_KEY);
}

export async function setAuthingAccessToken(accessToken: string): Promise<void> {
  await setAuthValue(AUTHING_ACCESS_TOKEN_KEY, accessToken);
}

export async function getAuthingAccessToken(): Promise<string | null> {
  return getAuthValue(AUTHING_ACCESS_TOKEN_KEY);
}

export async function clearAuthingAccessToken(): Promise<void> {
  await removeAuthValue(AUTHING_ACCESS_TOKEN_KEY);
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
