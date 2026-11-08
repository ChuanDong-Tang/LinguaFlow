import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, DevSettings } from "react-native";
import * as Updates from "expo-updates";
import { appearance, type AppearancePreference, type ResolvedAppearance } from "./state";

const STORAGE_KEY = "oio.appearance.v1";

function resolve(preference: AppearancePreference): ResolvedAppearance {
  if (preference === "system") return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  return preference;
}

/** Read the saved preference before the app is loaded. Never throws. */
export async function loadAppearance(): Promise<void> {
  let preference: AppearancePreference = "system";
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {
    // Fall back to following the system.
  }
  appearance.preference = preference;
  appearance.resolved = resolve(preference);
}

/** Whether following the system would change the palette right now. */
export function systemAppearanceChanged(): boolean {
  return appearance.preference === "system" && resolve("system") !== appearance.resolved;
}

export async function reloadForAppearance(): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    DevSettings.reload();
  }
}

/** Save the preference and reload so every screen picks up the new palette. */
export async function setAppearancePreference(preference: AppearancePreference): Promise<void> {
  if (preference === appearance.preference) return;
  await AsyncStorage.setItem(STORAGE_KEY, preference);
  if (resolve(preference) === appearance.resolved) {
    appearance.preference = preference;
    return;
  }
  await reloadForAppearance();
}
