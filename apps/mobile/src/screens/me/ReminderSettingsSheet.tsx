import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, Switch, View } from "react-native";
import { Text } from "../../components/Typography";
import { CheckMark } from "../../components/surface/Surface";
import { haptic } from "../../feedback/haptics";
import { t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { applyReminderSettings, DEFAULT_REMINDERS, loadReminderSettings, type ReminderKind, type ReminderSettings } from "../../services/reminders/memoryReminders";

const TIMES = [[8, 0], [12, 30], [18, 0], [21, 0], [22, 30]] as const;

export function reminderSummary(settings: ReminderSettings): string {
  if (!settings.enabled) return t("reminders.off");
  return `${String(settings.hour).padStart(2, "0")}:${String(settings.minute).padStart(2, "0")}`;
}

/** 我的 → 回忆提醒: on/off, time, and what to be reminded of (local notifications). */
export function ReminderSettingsSheet({ visible, onClose, onChanged }: { visible: boolean; onClose: () => void; onChanged: (settings: ReminderSettings) => void }) {
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDERS);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) void loadReminderSettings().then(setSettings); }, [visible]);
  const copy = {
    today: { title: t("reminders.today.title"), body: t("reminders.today.body") },
    lastWeek: { title: t("reminders.last_week.title"), body: t("reminders.last_week.body") },
  };
  async function save(next: ReminderSettings) {
    setSettings(next);
    setSaving(true);
    try {
      const ok = await applyReminderSettings(next, copy);
      if (!ok) {
        setSettings({ ...next, enabled: false });
        Alert.alert(t("reminders.permission_title"), t("reminders.permission_message"));
      }
      onChanged(ok ? next : { ...next, enabled: false });
    } finally { setSaving(false); }
  }
  const toggleKind = (kind: ReminderKind) => {
    const has = settings.kinds.includes(kind);
    const kinds = has ? settings.kinds.filter((item) => item !== kind) : [...settings.kinds, kind];
    if (!kinds.length) return;
    haptic.select();
    void save({ ...settings, kinds });
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={() => undefined}>
        <View style={styles.handle} />
        <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>{t("reminders.title")}</Text>
            <Text style={styles.caption}>{t("reminders.caption")}</Text>
          </View>
          {saving ? <ActivityIndicator color={theme.colors.textMuted} /> : null}
          <Switch value={settings.enabled} onValueChange={(enabled) => { haptic.select(); void save({ ...settings, enabled }); }} trackColor={{ true: theme.colors.accent, false: theme.colors.fill3 }} />
        </View>
        <View style={[styles.section, !settings.enabled && { opacity: 0.45 }]} pointerEvents={settings.enabled ? "auto" : "none"}>
          <Text style={styles.label}>{t("reminders.time")}</Text>
          <View style={styles.times}>
            {TIMES.map(([hour, minute]) => {
              const on = settings.hour === hour && settings.minute === minute;
              return <Pressable key={`${hour}:${minute}`} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.time, on && styles.timeOn]} onPress={() => { haptic.select(); void save({ ...settings, hour, minute }); }}>
                <Text style={[styles.timeText, on && styles.timeTextOn]}>{`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}</Text>
              </Pressable>;
            })}
          </View>
          <Text style={styles.label}>{t("reminders.content")}</Text>
          {(["today", "lastWeek"] as const).map((kind) => <Pressable key={kind} accessibilityRole="checkbox" accessibilityState={{ checked: settings.kinds.includes(kind) }} style={styles.kindRow} onPress={() => toggleKind(kind)}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.kindTitle}>{copy[kind].title}</Text>
              <Text style={styles.caption}>{copy[kind].body}</Text>
            </View>
            {settings.kinds.includes(kind) ? <CheckMark size={18} /> : <View style={styles.unchecked} />}
          </Pressable>)}
        </View>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: theme.colors.scrim },
  sheet: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: theme.colors.surface, gap: 14 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.fill3 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
  caption: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  section: { gap: 10 },
  label: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 4 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  time: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: theme.colors.fill2, justifyContent: "center" },
  timeOn: { backgroundColor: theme.colors.accent },
  timeText: { color: theme.colors.text, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  timeTextOn: { color: theme.colors.onAccent },
  kindRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  kindTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  unchecked: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: theme.colors.borderStrong },
}));
