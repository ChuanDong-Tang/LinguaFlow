import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";

/**
 * Close an in-app overlay with the Android back button instead of exiting the app.
 * BackHandler calls the most recently registered listener first, so the overlay
 * opened last is the one that closes.
 */
export function useAndroidBack(enabled: boolean, onBack: () => void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!enabled || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      handler.current();
      return true;
    });
    return () => subscription.remove();
  }, [enabled]);
}
