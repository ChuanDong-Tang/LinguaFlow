import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/Typography";
import { getLanguage, t } from "../../i18n";

const labels = {
  "zh-CN": ["浏览设置", "每页显示", "每组数量", "重新排列"],
  "zh-TW": ["瀏覽設定", "每頁顯示", "每組數量", "重新排列"],
  "en-US": ["View settings", "Per page", "Per set", "Reshuffle"],
  "ja-JP": ["表示設定", "ページの枚数", "セットの枚数", "並べ直す"],
};
export function MemoryDeckSettings({ count, visible, disabled, onApply }: {
  count: number; visible: number; disabled?: boolean;
  onApply: (count: number, visible: number) => void;
}) {
  const copy = labels[getLanguage() as keyof typeof labels] ?? labels["en-US"];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ count, visible });
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={copy[0]} accessibilityState={{ expanded: open, disabled }} disabled={disabled}
      style={styles.trigger} onPress={() => { setDraft({ count, visible }); setOpen(true); }}>
      <Text style={styles.caption}>{copy[2]} · {count}</Text><Ionicons name="chevron-down" size={14} color="#777777" />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t("common.cancel")} onPress={() => setOpen(false)} />
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
          {[{ key: "visible" as const, label: copy[1], values: [1, 2, 3] }, { key: "count" as const, label: copy[2], values: [5, 15, 30] }].map(row => <View key={row.key} style={styles.row}>
            <Text style={styles.caption}>{row.label}</Text>
            <View style={styles.options}>{row.values.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${row.label}: ${value}`} accessibilityState={{ checked: draft[row.key] === value }} style={[styles.option, draft[row.key] === value && styles.selected]} onPress={() => setDraft(current => ({ ...current, [row.key]: value }))}><Text style={styles.value}>{value}</Text></Pressable>)}</View>
          </View>)}
          <Pressable disabled={disabled} style={styles.apply} onPress={() => { onApply(draft.count, draft.visible); setOpen(false); }}><Text style={styles.value}>{copy[3]}</Text></Pressable>
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  trigger: { alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  caption: { color: "#777777", fontSize: 13 }, value: { color: "#222222", fontSize: 15 },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.12)" },
  sheet: { width: 310, maxWidth: "100%", borderRadius: 12, backgroundColor: "#FFFFFF", padding: 18, gap: 18 },
  row: { gap: 8 }, options: { flexDirection: "row", gap: 8 },
  option: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  selected: { backgroundColor: "#EFEFEF" },
  apply: { minHeight: 44, justifyContent: "center", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#EEEEEE" },
});
