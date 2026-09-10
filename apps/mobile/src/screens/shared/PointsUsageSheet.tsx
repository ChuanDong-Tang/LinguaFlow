import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t } from "../../i18n";
import { theme } from "../../theme";

const features = [
  { key: "pro.points.dictionary", charged: false },
  { key: "pro.points.voice_input", charged: false },
  { key: "pro.points.playback", charged: false },
  { key: "pro.points.rewrite", charged: true, rateKey: "pro.points.ai_rate" },
  { key: "pro.points.reply", charged: true, rateKey: "pro.points.ai_rate" },
  { key: "pro.points.assistant_beta", charged: true, rateKey: "pro.points.ai_rate" },
  { key: "pro.points.tts", charged: true, rateKey: "pro.points.tts_rate" },
] as const;

export function PointsUsageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={t("card_detail.a11y.close")} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.sheet, { maxHeight: height * .82, paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{t("pro.points.title")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("card_detail.a11y.close")} hitSlop={10} onPress={onClose}><Ionicons name="close" size={22} color={theme.colors.textSecondary} /></Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View>
            {features.map((feature, index) => (
              <React.Fragment key={feature.key}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.row}>
                  <View style={styles.featureText}>
                    <Text style={styles.label}>{t(feature.key)}</Text>
                    {feature.charged ? <Text style={styles.description}>
                      {t(feature.key === "pro.points.tts" ? "pro.points.tts_counting" : "pro.points.counting")}
                    </Text> : null}
                  </View>
                  <Text style={[styles.value, !feature.charged && styles.free]}>
                    {t(feature.charged ? feature.rateKey : "pro.points.free")}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "transparent" },
  sheet: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 8 },
  handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: "#D8D8D8", alignSelf: "center", marginTop: 10, marginBottom: 18 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 20 },
  title: { flex: 1, fontSize: 20, fontWeight: "600", color: theme.colors.text },
  content: { paddingBottom: 12, gap: 16 },
  description: { fontSize: 13, lineHeight: 21, color: theme.colors.textSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 16 },
  featureText: { flex: 1, gap: 4 },
  label: { fontSize: 15, lineHeight: 23, fontWeight: "500", color: theme.colors.text },
  value: { fontSize: 14, fontWeight: "600", color: theme.colors.text, textAlign: "right", flexShrink: 1 },
  free: { color: "#3F7D65" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
});
