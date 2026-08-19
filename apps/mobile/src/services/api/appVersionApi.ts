import Constants from "expo-constants";
import { Platform } from "react-native";
import { fetchWithTimeout } from "./fetchWithTimeout";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type AppVersionPolicy = {
  platform: "ios" | "android";
  enabled: boolean;
  latestVersion: string | null;
  storeUrl: string;
};

type ApiResult =
  | { ok: true; data: AppVersionPolicy }
  | { ok: false; error: { code: string; message: string } };

export type AvailableAppUpdate = {
  latestVersion: string;
  storeUrl: string;
};

export async function getAvailableAppUpdate(): Promise<AvailableAppUpdate | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  const currentVersion = Constants.nativeAppVersion ?? Constants.expoConfig?.version;
  if (!currentVersion) return null;

  const mockVersion = __DEV__ ? process.env.EXPO_PUBLIC_MOCK_APP_UPDATE_VERSION?.trim() : null;
  if (mockVersion && compareVersions(currentVersion, mockVersion) < 0) {
    return {
      latestVersion: mockVersion,
      storeUrl: Platform.OS === "ios"
        ? "https://apps.apple.com/app/id6776898160"
        : "https://play.google.com/store/apps/details?id=com.yueyantech.oio",
    };
  }

  if (!BASE_URL) return null;

  const response = await fetchWithTimeout(`${BASE_URL}/app/version?platform=${Platform.OS}`, {}, 8_000);
  if (!response.ok) throw new Error(`APP_VERSION_HTTP_${response.status}`);
  const result = await response.json() as ApiResult;
  if (!result.ok || !result.data.enabled || !result.data.latestVersion) return null;
  if (compareVersions(currentVersion, result.data.latestVersion) >= 0) return null;

  return {
    latestVersion: result.data.latestVersion,
    storeUrl: result.data.storeUrl,
  };
}

export function compareVersions(left: string, right: string): number {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function numericVersionParts(value: string): number[] {
  return value.split(".").map((part) => {
    const match = part.match(/^\d+/u);
    return match ? Number(match[0]) : 0;
  });
}
