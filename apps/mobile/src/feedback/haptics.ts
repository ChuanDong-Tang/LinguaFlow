import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// Single entry point for haptic feedback (see skills/linguaflow-interaction-feel).
// Throttled so a burst of events produces at most one tick per 120 ms.
let last = 0;
function fire(run: () => Promise<void>) {
  if (Platform.OS === "web") return;
  const now = Date.now();
  if (now - last < 120) return;
  last = now;
  run().catch(() => undefined);
}

export const haptic = {
  select: () => fire(() => Haptics.selectionAsync()),
  light: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
export type HapticKind = keyof typeof haptic;
