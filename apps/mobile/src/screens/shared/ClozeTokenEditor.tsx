import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ClozeToken } from "../../domain/cloze/clozeUtils";
import { t } from "../../i18n";
import { theme } from "../../theme";

export type ClozeTokenEditorValue = {
  tokens: ClozeToken[];
  selectedTokenIndexes: number[];
};

export function ClozeTokenEditor({
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  value: ClozeTokenEditorValue | null;
  onChange: (selectedTokenIndexes: number[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const lastValueRef = React.useRef<ClozeTokenEditorValue | null>(null);
  if (value) lastValueRef.current = value;
  const visibleValue = value ?? lastValueRef.current;
  const selected = new Set(visibleValue?.selectedTokenIndexes ?? []);
  return (
    <Modal visible={Boolean(value)} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("cloze.edit")}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.tokens} alwaysBounceVertical={false}>
            {visibleValue?.tokens.map((token) => {
              const active = selected.has(token.index);
              return (
                <Pressable
                  key={token.index}
                  style={[styles.token, active && styles.tokenActive]}
                  onPress={() => {
                    const next = new Set(selected);
                    if (next.has(token.index)) next.delete(token.index);
                    else next.add(token.index);
                    onChange(Array.from(next).sort((left, right) => left - right));
                  }}
                >
                  <Text style={[styles.tokenText, active && styles.tokenTextActive]}>{token.text}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.cancel} onPress={onCancel}><Text style={styles.cancelText}>{t("common.cancel")}</Text></Pressable>
            <Pressable style={styles.confirm} onPress={onConfirm}><Text style={styles.confirmText}>{t("common.confirm")}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.25)", alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  card: { width: "100%", maxHeight: "72%", borderRadius: 16, backgroundColor: "#FFFFFF", paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16 },
  title: { color: "#111111", fontSize: 18, fontWeight: "800", textAlign: "center", marginBottom: 16 },
  scroll: { maxHeight: 320 },
  tokens: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 12 },
  token: { minHeight: 34, borderRadius: 7, borderWidth: 1, borderColor: "#D9DDF0", paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  tokenActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  tokenText: { color: "#111111", fontSize: 15 },
  tokenTextActive: { color: theme.colors.accentStrong, fontWeight: "700" },
  actions: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", gap: 12 },
  cancel: { flex: 1, height: 42, borderRadius: 21, backgroundColor: "#F1F3F7", alignItems: "center", justifyContent: "center" },
  cancelText: { color: "#515866", fontSize: 15, fontWeight: "700" },
  confirm: { flex: 1, height: 42, borderRadius: 21, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  confirmText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
