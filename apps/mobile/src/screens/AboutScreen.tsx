import React from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";
import Constants from "expo-constants";
import { t } from "../i18n";

export function getAppVersionText() {
  const version =
    Constants.nativeAppVersion ??
    Constants.expoConfig?.version ??
    "unknown";

  //const build = Constants.nativeBuildVersion;
  return version;
}


type AboutScreenProps = {
  onBack: () => void;
};

export function AboutScreen({ onBack }: AboutScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("about.title")}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandBlock}>
          <Image source={require("../../assets/app/logo.png")} style={styles.logoImage} resizeMode="contain" />
        </View>

        <SectionCard title={t("about.contact")}>
          <InfoRow icon="globe-outline" label={t("about.website")} value="www.yueyantech.com" onPress={() => openUrl("https://yueyantech.com")} />
          <InfoRow
            icon="create-outline"
            label={t("about.feedback")}
            value="contact@yueyantech.com"
          />
        </SectionCard>

        <SectionCard title={t("about.more")}>
          <InfoRow icon="information-circle-outline" label={t("about.version")} value={getAppVersionText()} />
          <InfoRow icon="shield-outline" label={t("about.privacy")} value="" onPress={() => openUrl(PRIVACY_URL)} />
          <InfoRow icon="document-text-outline" label={t("about.terms")} value="" onPress={() => openUrl(TERMS_URL)} isLast />
        </SectionCard>

        <Text style={styles.footer}>{t("about.footer.copyright")}</Text>
        <Text style={styles.footer}>{t("about.footer.icp")}</Text>
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
      <Ionicons name={icon} size={19} color="#111111" />
      <Text style={styles.rowLabel}>{label}</Text>
      {!!value && <Text style={styles.rowValue}>{value}</Text>}
      <Ionicons name="chevron-forward" size={17} color="#3C3F48" />
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
  headerTitle: { color: "#111111", fontSize: 17, fontWeight: "500" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 26 },
  brandBlock: { alignItems: "center", marginTop: 14, marginBottom: 18 },
  logo: { fontSize: 30, color: "#111111", letterSpacing: 1 },
  brand: { marginTop: 4, fontSize: 14, color: "#111111", fontWeight: "500" },
  tagline: { marginTop: 8, fontSize: 12, color: "#656B78" },
  slogan: { marginTop: 12, fontSize: 13, color: "#656B78" },
  section: { marginBottom: 14 },
  sectionTitle: { marginBottom: 8, fontSize: 14, color: "#111111", fontWeight: "500" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: "#ECEEF2" },
  rowLabel: { flex: 1, marginLeft: 12, color: "#111111", fontSize: 14 },
  rowValue: { marginRight: 8, color: "#575E6E", fontSize: 13 },
  footer: { marginTop: 12, textAlign: "center", color: "#767C89", fontSize: 12 },

  logoImage: {
    width: 180,
    height: 180,
    marginTop: 40,
  },
});
