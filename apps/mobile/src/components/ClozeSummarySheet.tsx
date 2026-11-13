import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { popupEnter } from "../motion";
import { Text } from "./Typography";
import { haptic } from "../feedback/haptics";
import { t } from "../i18n";
import { theme } from "../theme";
import { createStyles } from "../styles";
import type { CardClozeSessionSummary } from "../domain/cloze/cardClozeCorrectness";

/**
 * End-of-card cloze summary (2026-11): accuracy on top, then the missed
 * answers (yellow) on the left and the right ones (green) on the right.
 */
export function ClozeSummarySheet({ summary, onClose }: { summary: CardClozeSessionSummary | null; onClose: () => void }) {
  if (!summary) return null;
  const perfect = summary.incorrect.length === 0;
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      {/* Tap outside closes; the panel is a sibling so its lists can scroll. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Reanimated.View entering={popupEnter} style={styles.panel}>
        <Text style={[styles.accuracy, { color: perfect ? theme.colors.accent : theme.colors.text }]}>{summary.accuracy}%</Text>
        <Text style={styles.caption}>{t("cloze.summary.accuracy")}</Text>
        <View style={styles.columns}>
          <Column title={t("cloze.summary.missed")} tone="incorrect" items={summary.incorrect.map((item) => item.answer)} />
          <Column title={t("cloze.summary.right")} tone="correct" items={summary.correct.map((item) => item.answer)} />
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} onPress={() => { haptic.light(); onClose(); }}>
          <Text style={styles.buttonText}>{t("cloze.summary.done")}</Text>
        </Pressable>
      </Reanimated.View>
    </View>
  </Modal>;
}

function Column({ title, tone, items }: { title: string; tone: "correct" | "incorrect"; items: string[] }) {
  const color = tone === "correct" ? theme.colors.accent : theme.colors.warning;
  const fill = tone === "correct" ? theme.colors.accentSoft : theme.colors.warningSoft;
  return <View style={styles.column}>
    <Text style={[styles.columnTitle, { color }]}>{title} · {items.length}</Text>
    <ScrollView style={styles.columnList} contentContainerStyle={{ gap: 6 }} nestedScrollEnabled showsVerticalScrollIndicator>
      {items.length ? items.map((item, index) => <View key={`${item}-${index}`} style={[styles.chip, { backgroundColor: fill }]}>
        <Text numberOfLines={2} style={styles.chipText}>{item}</Text>
      </View>) : <Text style={styles.empty}>—</Text>}
    </ScrollView>
  </View>;
}

const styles = createStyles(() => ({
  backdrop: { flex: 1, backgroundColor: theme.colors.scrim, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  panel: { width: "100%", maxWidth: 380, borderRadius: 20, backgroundColor: theme.colors.surface, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 18 },
  accuracy: { fontSize: 44, lineHeight: 52, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"] },
  caption: { color: theme.colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 2 },
  columns: { flexDirection: "row", gap: 12, marginTop: 20 },
  column: { flex: 1, minWidth: 0 },
  columnTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
  columnList: { maxHeight: 220 },
  chip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  chipText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  empty: { color: theme.colors.textFaint, fontSize: 14 },
  button: { marginTop: 20, height: 46, borderRadius: 23, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  buttonText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "700" },
}));
