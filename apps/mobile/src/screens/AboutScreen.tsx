import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";

type AboutScreenProps = {
  onBack: () => void;
};

export function AboutScreen({ onBack }: AboutScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>关于 OIO</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandBlock}>
          <Text style={styles.logo}>oio</Text>
          <Text style={styles.brand}>OIO</Text>
          <Text style={styles.tagline}>Output  ·  Input  ·  Output</Text>
          <Text style={styles.slogan}>一个安静的 AI 表达工具</Text>
        </View>

        <SectionCard title="联系方式">
          <InfoRow icon="globe-outline" label="官方网站" value="www.oio.app" onPress={() => openUrl("https://www.oio.app")} />
          <InfoRow icon="mail-outline" label="联系邮箱" value="hello@oio.app" onPress={() => openUrl("mailto:hello@oio.app")} />
          <InfoRow icon="chatbubble-ellipses-outline" label="微信客服" value="OIO_support" />
          <InfoRow icon="create-outline" label="意见反馈" value="欢迎向我们发送建议" isLast />
        </SectionCard>

        <SectionCard title="更多信息">
          <InfoRow icon="information-circle-outline" label="当前版本" value="1.0.0" />
          <InfoRow icon="shield-outline" label="隐私政策" value="" onPress={() => openUrl(PRIVACY_URL)} />
          <InfoRow icon="document-text-outline" label="用户协议" value="" onPress={() => openUrl(TERMS_URL)} isLast />
        </SectionCard>

        <Text style={styles.footer}>© 2026 OIO</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  onPress,
  isLast,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable style={[styles.row, !isLast && styles.rowBorder]} onPress={onPress} disabled={!onPress}>
      <Ionicons name={icon} size={22} color="#111111" />
      <Text style={styles.rowLabel}>{label}</Text>
      {!!value && <Text style={styles.rowValue}>{value}</Text>}
      <Ionicons name="chevron-forward" size={20} color="#3C3F48" />
    </Pressable>
  );
}

function openUrl(url: string): void {
  void Linking.openURL(url);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FCFCFD" },
  header: {
    height: 60,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#111111", fontSize: 21, fontWeight: "600" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 26 },
  brandBlock: { alignItems: "center", marginTop: 22, marginBottom: 24 },
  logo: { fontSize: 42, color: "#111111", letterSpacing: 2 },
  brand: { marginTop: 6, fontSize: 16, color: "#111111", fontWeight: "600" },
  tagline: { marginTop: 10, fontSize: 13, color: "#656B78" },
  slogan: { marginTop: 18, fontSize: 14, color: "#656B78" },
  section: { marginBottom: 18 },
  sectionTitle: { marginBottom: 10, fontSize: 16, color: "#111111", fontWeight: "600" },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  row: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: "#ECEEF2" },
  rowLabel: { marginLeft: 14, color: "#111111", fontSize: 16 },
  rowValue: { marginLeft: "auto", marginRight: 10, color: "#575E6E", fontSize: 15 },
  footer: { marginTop: 12, textAlign: "center", color: "#767C89", fontSize: 12 },
});
