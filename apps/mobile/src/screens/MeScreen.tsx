import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";
import { getSession, type AuthSession } from "../services/authStorage";
import { getCurrentEntitlement, type CurrentEntitlement } from "../services/meApi";
import { getCachedEntitlement, isSameEntitlement, setCachedEntitlement } from "../services/entitlementCache";
import { recoverPendingPaymentIfAny } from "../services/paymentRecovery";
import { TabBar } from "./shared/TabBar";

type MeScreenProps = {
  onOpenMain: () => void;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void> | void;
};

export function MeScreen({ onOpenMain, onOpenPro, onOpenAbout, onLogout }: MeScreenProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [isLoadingEntitlement, setIsLoadingEntitlement] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function loadProfile() {
      await recoverPendingPaymentIfAny();
      const [localSession, cached] = await Promise.all([getSession(), getCachedEntitlement()]);
      if (mounted) setSession(localSession);
      if (cached && mounted) setEntitlement(cached.data);
      if (mounted) setIsLoadingEntitlement(!cached);
      try {
        const data = await getCurrentEntitlement();
        if (!cached || !isSameEntitlement(cached.data, data)) await setCachedEntitlement(data);
        if (mounted) setEntitlement((prev) => (isSameEntitlement(prev, data) ? prev : data));
      } catch {
      } finally {
        if (mounted) setIsLoadingEntitlement(false);
      }
    }
    void loadProfile();
    return () => { mounted = false; };
  }, []);

  const quota = useMemo(() => {
    const dailyTotalLimit = entitlement?.dailyTotalLimit ?? (session?.sessionFlags?.isPro ? 100000 : 10000);
    const remainingChars = entitlement?.remainingChars ?? null;
    const ratio = remainingChars === null || dailyTotalLimit <= 0 ? 0 : remainingChars / dailyTotalLimit;
    return { dailyTotalLimit, remainingChars, ratio: Math.max(0, Math.min(1, ratio)) };
  }, [entitlement, session?.sessionFlags?.isPro]);

  const userName = session?.user.displayName || "微信用户";
  const planLabel = (entitlement?.isPro ?? session?.sessionFlags?.isPro === true) ? "Pro" : "普通版";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroller} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileRow}>
          <View style={styles.profileAvatar}><Ionicons name="person-outline" size={58} color="#111111" /></View>
          <View style={styles.profileBody}><Text style={styles.profileName}>{userName}</Text><Text style={styles.profilePlan}>{planLabel}</Text></View>
        </View>

        <View style={styles.quotaCard}>
          <Text style={styles.cardTitle}>今日字符额度</Text>
          <View style={styles.quotaRow}>
            <Text style={styles.quotaLabel}>今日剩余</Text>
            <Text style={styles.quotaNumber}>{quota.remainingChars === null ? "--" : formatNumber(quota.remainingChars)}</Text>
            <Text style={styles.quotaUnit}>字</Text>
            {isLoadingEntitlement ? <ActivityIndicator size="small" color="#6E63FF" style={styles.quotaLoading} /> : null}
          </View>
          <View style={styles.progressRow}><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${quota.ratio * 100}%` }]} /></View><Text style={styles.progressText}>{quota.remainingChars === null ? "--" : formatNumber(quota.remainingChars)} / {formatNumber(quota.dailyTotalLimit)}</Text></View>
          <Text style={styles.resetText}>每天 24:00 自动恢复</Text>
        </View>

        <View style={styles.proCard}>
          <Text style={styles.proTitle}>OIO Pro</Text>
          <Text style={styles.proSubtitle}>更充足的字符额度，更自由地表达</Text>
          { ["更多每日字符额度", "支持更长文本改写", "更高频使用"].map((item) => (
            <View key={item} style={styles.benefitRow}><Ionicons name="checkmark-circle-outline" size={18} color="#6E63FF" /><Text style={styles.benefitText}>{item}</Text></View>
          ))}
          <Pressable style={styles.proButton} onPress={onOpenPro}><Text style={styles.proButtonText}>查看 Pro</Text><Ionicons name="chevron-forward" size={20} color="#111111" /></Pressable>
        </View>

        <Text style={styles.sectionTitle}>更多</Text>
        <View style={styles.settingsCard}>
          <SettingsRow icon="information-circle-outline" label="关于 OIO" onPress={onOpenAbout} />
          <SettingsRow icon="shield-outline" label="隐私政策" onPress={() => openUrl(PRIVACY_URL)} />
          <SettingsRow icon="document-text-outline" label="用户协议" onPress={() => openUrl(TERMS_URL)} />
          <SettingsRow icon="log-out-outline" label="退出登录" onPress={onLogout} isLast />
        </View>
      </ScrollView>
      <TabBar activeTab="me" onPressChat={onOpenMain} onPressMe={onOpenMain} />
    </SafeAreaView>
  );
}

function SettingsRow({ icon, label, onPress, isLast }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void | Promise<void>; isLast?: boolean; }) {
  return <Pressable style={[styles.settingsRow, !isLast && styles.settingsRowBorder]} onPress={onPress}><Ionicons name={icon} size={22} color="#111111" /><Text style={styles.settingsLabel}>{label}</Text><Ionicons name="chevron-forward" size={20} color="#111111" /></Pressable>;
}
function openUrl(url: string): void { void Linking.openURL(url); }
function formatNumber(value: number): string { return new Intl.NumberFormat("en-US").format(value); }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FCFCFD" },
  scroller: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 26 },
  profileRow: { marginTop: 18, flexDirection: "row", alignItems: "center" },
  profileAvatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: "#F0ECFF", alignItems: "center", justifyContent: "center" },
  profileBody: { marginLeft: 20 },
  profileName: { color: "#111111", fontSize: 22, fontWeight: "600" },
  profilePlan: { marginTop: 6, color: "#606780", fontSize: 14 },
  quotaCard: { marginTop: 22, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: "#E1E5EE", backgroundColor: "#FFFFFF" },
  cardTitle: { color: "#111111", fontSize: 16, fontWeight: "600" },
  quotaRow: { marginTop: 16, flexDirection: "row", alignItems: "baseline" },
  quotaLabel: { color: "#5F6675", fontSize: 13 },
  quotaNumber: { marginLeft: 10, color: "#6E63FF", fontSize: 28, fontWeight: "600" },
  quotaUnit: { marginLeft: 6, color: "#111111", fontSize: 16 },
  quotaLoading: { marginLeft: 8 },
  progressRow: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  progressTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: "#ECEFF5", overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: "#6E63FF" },
  progressText: { color: "#5F6675", fontSize: 12, minWidth: 104, textAlign: "right" },
  resetText: { marginTop: 12, color: "#5F6675", fontSize: 13 },
  proCard: { marginTop: 18, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: "#E1E5EE", backgroundColor: "#FFFFFF" },
  proTitle: { color: "#111111", fontSize: 22, fontWeight: "600" },
  proSubtitle: { marginTop: 8, color: "#5E6573", fontSize: 14 },
  benefitRow: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  benefitText: { color: "#5E6573", fontSize: 14 },
  proButton: { marginTop: 14, height: 48, borderRadius: 14, borderWidth: 1, borderColor: "#CDD2DE", flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  proButtonText: { color: "#111111", fontSize: 17, fontWeight: "500" },
  sectionTitle: { marginTop: 18, marginBottom: 10, color: "#5E6573", fontSize: 15 },
  settingsCard: { borderRadius: 16, borderWidth: 1, borderColor: "#E1E5EE", backgroundColor: "#FFFFFF", overflow: "hidden" },
  settingsRow: { minHeight: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" },
  settingsRowBorder: { borderBottomWidth: 1, borderBottomColor: "#ECEEF2" },
  settingsLabel: { flex: 1, marginLeft: 12, color: "#111111", fontSize: 16 },
});
