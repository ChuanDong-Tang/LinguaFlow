import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { createFontSizeStore, FONT_SCALES } from "./fontSizeState";
export const fontSizePreference = createFontSizeStore(AsyncStorage);
export function useFontSize() {
  const size = useSyncExternalStore(fontSizePreference.subscribe, fontSizePreference.getSnapshot, fontSizePreference.getSnapshot);
  return { size, scale: FONT_SCALES[size] };
}
