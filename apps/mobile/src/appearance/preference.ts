import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { appearance, type AppearancePreference, type ResolvedAppearance } from "./state";

// Boot-time loading only. Keep this file free of theme/style imports: it runs
// before the app (and theme.ts) is evaluated. Live switching is in switch.ts.

export const APPEARANCE_STORAGE_KEY = "oio.appearance.v1";

export function resolveAppearance(preference: AppearancePreference): ResolvedAppearance {
  if (preference === "system") return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  return preference;
}

/** Read the saved preference before the app is loaded. Never throws. */
export async function loadAppearance(): Promise<void> {
  let preference: AppearancePreference = "system";
  try {
    const stored = await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") preference = stored;
  } catch {
    // Fall back to following the system.
  }
  appearance.preference = preference;
  appearance.resolved = resolveAppearance(preference);
}
