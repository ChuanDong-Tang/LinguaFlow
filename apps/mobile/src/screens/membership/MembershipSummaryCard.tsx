import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../../theme";
import { t } from "../../i18n";

type MembershipSummaryCardProps = {
  tierLabel: string;
  expiresLabel: string | null;
  sourceLabel: string | null;
  loading: boolean;
  onPress: () => void;
};

export function MembershipSummaryCard({
  tierLabel,
  expiresLabel,
  sourceLabel,
  loading,
  onPress,
}: MembershipSummaryCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("subscription.manager.title")}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="sparkles-outline" size={20} color={theme.colors.text} />
      </View>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{t("pro.current.title")}</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{tierLabel}</Text>
          {loading ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : null}
        </View>
        {expiresLabel ? <Text style={styles.meta}>{expiresLabel}</Text> : null}
        {sourceLabel ? <Text style={styles.meta}>{sourceLabel}</Text> : null}
      </View>
      <View style={styles.action}>
        <Text style={styles.actionText}>{t("subscription.manager.title")}</Text>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 96,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 17,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  cardPressed: { opacity: 0.65 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceMuted,
  },
  body: { flex: 1, marginLeft: 13 },
  eyebrow: { color: theme.colors.textMuted, fontSize: 11 },
  titleRow: { marginTop: 2, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: "600" },
  meta: { marginTop: 3, color: theme.colors.textSecondary, fontSize: 12 },
  action: { marginLeft: 12, flexDirection: "row", alignItems: "center" },
  actionText: { color: theme.colors.textSecondary, fontSize: 13 },
});
