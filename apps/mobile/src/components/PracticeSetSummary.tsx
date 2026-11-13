import React, { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { popupEnter } from "../motion";
import { Text } from "./Typography";
import { OioMascot, type OioMascotHandle } from "./sketch/OioMascot";
import { haptic } from "../feedback/haptics";
import { playSuccessFeedbackSound } from "../services/audio/gameFeedbackAudio";
import { t, tf } from "../i18n";
import { theme } from "../theme";
import { createStyles } from "../styles";
import type { PracticeSessionSummary } from "../services/practice/practiceSession";

/** End-of-set 战绩 (盲盒, 2026-11): cards, accuracy, right / wrong — a small celebration. */
export function PracticeSetSummary({ summary, onClose, onAgain }: { summary: PracticeSessionSummary | null; onClose: () => void; onAgain?: () => void }) {
  const mascot = useRef<OioMascotHandle>(null);
  useEffect(() => {
    if (!summary) return;
    haptic.success();
    void playSuccessFeedbackSound().catch(() => undefined);
    const timer = setTimeout(() => mascot.current?.hop(), 250);
    return () => clearTimeout(timer);
  }, [summary]);
  if (!summary) return null;
  const great = summary.accuracy >= 80;
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Reanimated.View entering={popupEnter} style={styles.panel}>
        <OioMascot ref={mascot} size={64} idle={false} />
        <Text style={styles.title}>{t(great ? "practice_summary.great" : "practice_summary.good")}</Text>
        <Text style={[styles.accuracy, { color: great ? theme.colors.accent : theme.colors.text }]}>{summary.accuracy}%</Text>
        <Text style={styles.caption}>{t("cloze.summary.accuracy")}</Text>
        <View style={styles.stats}>
          <Stat value={summary.cards} label={t("practice_summary.cards")} />
          <Stat value={summary.right} label={t("cloze.summary.right")} color={theme.colors.accent} />
          <Stat value={summary.wrong} label={t("cloze.summary.missed")} color={theme.colors.warning} />
        </View>
        <View style={styles.actions}>
          {onAgain ? <Pressable accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.8 }]} onPress={() => { haptic.light(); onAgain(); }}>
            <Text style={styles.secondaryText}>{t("practice_summary.again")}</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]} onPress={() => { haptic.light(); onClose(); }}>
            <Text style={styles.primaryText}>{t("cloze.summary.done")}</Text>
          </Pressable>
        </View>
      </Reanimated.View>
    </View>
  </Modal>;
}

function Stat({ value, label, color }: { value: number; label: string; color?: string }) {
  return <View style={styles.stat}>
    <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, backgroundColor: theme.colors.scrim, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  panel: { width: "100%", maxWidth: 360, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: "center", paddingHorizontal: 22, paddingTop: 22, paddingBottom: 18 },
  title: { marginTop: 8, color: theme.colors.text, fontSize: 18, fontWeight: "800" },
  accuracy: { marginTop: 10, fontSize: 42, lineHeight: 50, fontWeight: "800", fontVariant: ["tabular-nums"] },
  caption: { color: theme.colors.textMuted, fontSize: 12 },
  stats: { flexDirection: "row", alignSelf: "stretch", marginTop: 18, gap: 8 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.fill1 },
  statValue: { color: theme.colors.text, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  statLabel: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12 },
  actions: { flexDirection: "row", alignSelf: "stretch", gap: 10, marginTop: 20 },
  secondary: { flex: 1, height: 46, borderRadius: 23, backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  primary: { flex: 1, height: 46, borderRadius: 23, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "700" },
}));
