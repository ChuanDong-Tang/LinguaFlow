import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { applyAppearancePalette } from "../theme";
import { regenerateStyles } from "../styles";
import { appearance, type AppearancePreference, type ResolvedAppearance } from "./state";
import { APPEARANCE_STORAGE_KEY, resolveAppearance } from "./preference";

// Live appearance switching (no reload): rewrite theme values, rebuild every
// createStyles() sheet, then notify the app root so it remounts its views.

const listeners = new Set<(resolved: ResolvedAppearance) => void>();

export function subscribeAppearance(listener: (resolved: ResolvedAppearance) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function apply(resolved: ResolvedAppearance) {
  if (resolved === appearance.resolved) return;
  applyAppearancePalette(resolved);
  regenerateStyles();
  for (const listener of listeners) listener(resolved);
}

export async function setAppearancePreference(preference: AppearancePreference): Promise<void> {
  await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  appearance.preference = preference;
  apply(resolveAppearance(preference));
}

/** Follow live system changes while the preference is "system". */
export function watchSystemAppearance() {
  const subscription = Appearance.addChangeListener(() => {
    if (appearance.preference === "system") apply(resolveAppearance("system"));
  });
  return () => subscription.remove();
}
