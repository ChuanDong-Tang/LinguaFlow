import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../components/Typography";
import { getLanguage, t } from "../../i18n";
import { theme } from "../../theme";
import { Ionicons } from "@expo/vector-icons";

export function MemorySetMenu({ title, count, disabled, onChange }: { title: string; count: number; disabled?: boolean; onChange: (count: number) => void }) {
  const [open, setOpen] = useState(false);
  const labels = { "zh-CN": "每组照片", "zh-TW": "每組照片", "en-US": "Photos per set", "ja-JP": "セットの枚数" };
  return <>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled), expanded: open }} disabled={disabled} onPress={() => setOpen(true)} style={styles.pill}><Text style={styles.label}>{title} · {count}</Text><Ionicons name="chevron-down" size={14} color={theme.colors.text} /></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel={t("common.cancel")} />
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={() => setOpen(false)}>
          {[5, 15, 30].map(size => <Pressable key={size} accessibilityRole="button" accessibilityLabel={`${labels[getLanguage() as keyof typeof labels] ?? labels["en-US"]}: ${size}`} accessibilityState={{ selected: size === count }} style={[styles.option, size === count && styles.selectedOption]} onPress={() => { onChange(size); setOpen(false); }}><Text style={[styles.label, size === count && styles.selectedLabel]}>{size}</Text></Pressable>)}
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  pill: { alignSelf: "flex-start", paddingHorizontal: 8, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
  label: { color: theme.colors.text, fontSize: 15, fontWeight: "400" },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.12)" },
  sheet: { width: 260, maxWidth: "100%", flexDirection: "row", gap: 6, borderRadius: 12, padding: 10, backgroundColor: "#FFFFFF", alignItems: "center", shadowColor: "#000000", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  option: { minHeight: 48, flex: 1, borderRadius: 6, justifyContent: "center", alignItems: "center" },
  selectedOption: { backgroundColor: "#EFEFEF" },
  selectedLabel: { fontWeight: "600" },
});
