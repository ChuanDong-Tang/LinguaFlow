import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// 回忆提醒 (2026-11 feedback): local daily notifications the user turns on in
// 我的 → e.g. "look at today's memories" / "this day last week". Local only —
// no push service, no server state.

export type ReminderKind = "today" | "lastWeek";
export type ReminderSettings = { enabled: boolean; hour: number; minute: number; kinds: ReminderKind[] };

const KEY = "oio.reminders.v1";
const CHANNEL = "oio-reminders";
export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, hour: 21, minute: 0, kinds: ["today"] };

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const value = raw ? JSON.parse(raw) as Partial<ReminderSettings> : {};
    const kinds = Array.isArray(value.kinds) ? value.kinds.filter((kind): kind is ReminderKind => kind === "today" || kind === "lastWeek") : DEFAULT_REMINDERS.kinds;
    return {
      enabled: value.enabled === true,
      hour: Number.isInteger(value.hour) ? Math.max(0, Math.min(23, value.hour!)) : DEFAULT_REMINDERS.hour,
      minute: Number.isInteger(value.minute) ? Math.max(0, Math.min(59, value.minute!)) : DEFAULT_REMINDERS.minute,
      kinds: kinds.length ? kinds : DEFAULT_REMINDERS.kinds,
    };
  } catch { return DEFAULT_REMINDERS; }
}

/**
 * Save and (re)schedule. Returns false when turning on was refused by the OS
 * permission prompt (the setting is then saved as off).
 */
export async function applyReminderSettings(next: ReminderSettings, copy: Record<ReminderKind, { title: string; body: string }>): Promise<boolean> {
  let settings = next;
  if (settings.enabled) {
    const granted = await ensurePermission();
    if (!granted) settings = { ...settings, enabled: false };
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => undefined);
  await cancelReminders();
  if (!settings.enabled) return !next.enabled;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "回忆提醒", importance: Notifications.AndroidImportance.DEFAULT }).catch(() => undefined);
  }
  for (const [index, kind] of settings.kinds.entries()) {
    // Two reminders a minute apart so they don't collapse into one.
    const minute = (settings.minute + index) % 60;
    await Notifications.scheduleNotificationAsync({
      content: { title: copy[kind].title, body: copy[kind].body, data: { oio: "reminder", kind } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: settings.hour, minute, ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}) },
    });
  }
  return true;
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function cancelReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(scheduled
    .filter((item) => (item.content.data as { oio?: string } | undefined)?.oio === "reminder")
    .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => undefined)));
}

/** Tapping a reminder (also on cold start): tell the home which view to open. */
export function subscribeReminderOpens(onOpen: (kind: ReminderKind) => void): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data as { oio?: string; kind?: ReminderKind } | undefined;
    if (data?.oio === "reminder" && (data.kind === "today" || data.kind === "lastWeek")) onOpen(data.kind);
  };
  void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
