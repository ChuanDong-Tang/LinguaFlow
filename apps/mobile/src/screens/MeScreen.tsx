import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";
import { getSession, type AuthSession } from "../services/authStorage";
import { getCurrentEntitlement, type CurrentEntitlement } from "../services/meApi";
import {
  getCachedEntitlement,
  isSameEntitlement,
  setCachedEntitlement,
} from "../services/entitlementCache";
import { TabBar } from "./shared/TabBar";

type MeScreenProps = {
  onOpenMain: () => void;
  onOpenPro: () => void;
  onLogout: () => Promise<void> | void;
};

export function MeScreen({ onOpenMain, onOpenPro, onLogout }: MeScreenProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [isLoadingEntitlement, setIsLoadingEntitlement] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      const [localSession, cached] = await Promise.all([
        getSession(),
        getCachedEntitlement(),
      ]);
      if (mounted) setSession(localSession);

      if (cached && mounted) {
        setEntitlement(cached.data);
      }

      if (mounted) setIsLoadingEntitlement(!cached);

      try {
        const data = await getCurrentEntitlement();
        await setCachedEntitlement(data);

        if (mounted) {
          setEntitlement((prev) => (isSameEntitlement(prev, data) ? prev : data));
        }
      } catch {
        // 我的页先用本地会话兜底，不阻塞进入页面。
      } finally {
        if (mounted) setIsLoadingEntitlement(false);
      }
    }

    void loadProfile();
    return () => {
      mounted = false;
    };
  }, []);

  const quota = useMemo(() => {
    const dailyTotalLimit = entitlement?.dailyTotalLimit ?? (session?.sessionFlags?.isPro ? 100000 : 10000);
    const remainingChars = entitlement?.remainingChars ?? null;
    const usedTotalChars = remainingChars === null ? 0 : Math.max(0, dailyTotalLimit - remainingChars);
    const ratio = remainingChars === null || dailyTotalLimit <= 0 ? 0 : remainingChars / dailyTotalLimit;
    return {
      dailyTotalLimit,
      remainingChars,
      usedTotalChars,
      ratio: Math.max(0, Math.min(1, ratio)),
    };
  }, [entitlement]);

  const userName = session?.user.displayName || "微信用户";
  const isPro = entitlement?.isPro ?? session?.sessionFlags?.isPro === true;
  const planLabel = isPro ? "OIO Pro" : "普通版";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroller}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>我的</Text>

        <View style={styles.profileRow}>
          <View style={styles.profileAvatar}>
            <Ionicons name="person-outline" size={32} color="#111111" />
          </View>

          <View style={styles.profileBody}>
            <Text style={styles.profileName}>{userName}</Text>
            <Text style={styles.profilePlan}>{planLabel}</Text>
          </View>

          <Ionicons name="chevron-forward" size={24} color="#111111" />
        </View>

        <View style={styles.quotaCard}>
          <Text style={styles.cardTitle}>今日字符额度</Text>
          <View style={styles.quotaRow}>
            <Text style={styles.quotaLabel}>今日剩余</Text>
            <Text style={styles.quotaNumber}>
              {quota.remainingChars === null ? "--" : formatNumber(quota.remainingChars)}
            </Text>
            <Text style={styles.quotaUnit}>字</Text>
            {isLoadingEntitlement ? <ActivityIndicator size="small" color="#8D83FF" style={styles.quotaLoading} /> : null}
          </View>
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${quota.ratio * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {quota.remainingChars === null ? "--" : formatNumber(quota.remainingChars)} / {formatNumber(quota.dailyTotalLimit)}
            </Text>
          </View>
          <Text style={styles.resetText}>每天 24:00 自动恢复</Text>
        </View>

        <View style={styles.proCard}>
          <View style={styles.proCopy}>
            <Text style={styles.proTitle}>OIO Pro</Text>
            <Text style={styles.proSubtitle}>更充足的字符额度，更自由地表达</Text>
            {["更多每日字符额度", "支持更长文本改写", "更高频使用"].map((item) => (
              <View key={item} style={styles.benefitRow}>
                <Ionicons name="checkmark-circle-outline" size={19} color="#8D83FF" />
                <Text style={styles.benefitText}>{item}</Text>
              </View>
            ))}
          </View>
          <Ionicons name="sparkles-outline" size={54} color="#111111" style={styles.proSpark} />
          <Pressable style={styles.proButton} onPress={onOpenPro}>
            <Text style={styles.proButtonText}>查看 Pro</Text>
            <Ionicons name="chevron-forward" size={22} color="#111111" />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>账号与设置</Text>
        <View style={styles.settingsCard}>
          <SettingsRow icon="shield-checkmark-outline" label="隐私政策" onPress={() => openUrl(PRIVACY_URL)} />
          <SettingsRow icon="document-text-outline" label="用户协议" onPress={() => openUrl(TERMS_URL)} />
          <SettingsRow icon="log-out-outline" label="退出登录" onPress={onLogout} isLast />
        </View>
      </ScrollView>

      <TabBar activeTab="me" onPressChat={onOpenMain} onPressMe={onOpenMain} />
    </SafeAreaView>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  isLast,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void | Promise<void>;
  isLast?: boolean;
}) {
  return (
    <Pressable style={[styles.settingsRow, !isLast && styles.settingsRowBorder]} onPress={onPress}>
      <Ionicons name={icon} size={23} color="#111111" />
      <Text style={styles.settingsLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={22} color="#111111" />
    </Pressable>
  );
}

function openUrl(url: string): void {
  void Linking.openURL(url);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  scroller: {
    flex: 1,
  },
  title: {
    marginTop: 14,
    color: "#111111",
    fontSize: 26,
    fontWeight: "700",
  },
  profileRow: {
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  profileBody: {
    flex: 1,
    marginLeft: 18,
  },
  profileName: {
    color: "#111111",
    fontSize: 21,
    fontWeight: "700",
  },
  profilePlan: {
    marginTop: 8,
    color: "#5E6573",
    fontSize: 15,
  },
  quotaCard: {
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E8E3FF",
    backgroundColor: "#FCFBFF",
  },
  cardTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "700",
  },
  quotaRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "baseline",
  },
  quotaLabel: {
    color: "#5F6675",
    fontSize: 14,
  },
  quotaNumber: {
    marginLeft: 12,
    color: "#8D83FF",
    fontSize: 30,
    fontWeight: "700",
  },
  quotaUnit: {
    marginLeft: 6,
    color: "#111111",
    fontSize: 16,
    fontWeight: "700",
  },
  quotaLoading: {
    marginLeft: 10,
  },
  progressRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#E8E7F0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#8579FF",
  },
  progressText: {
    minWidth: 110,
    color: "#5F6675",
    fontSize: 13,
    textAlign: "right",
  },
  resetText: {
    marginTop: 14,
    color: "#5F6675",
    fontSize: 15,
  },
  proCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#EFE7D8",
    backgroundColor: "#FFFDF8",
  },
  proCopy: {
    paddingRight: 66,
  },
  proTitle: {
    color: "#111111",
    fontSize: 22,
    fontWeight: "700",
  },
  proSubtitle: {
    marginTop: 10,
    marginBottom: 12,
    color: "#5E6573",
    fontSize: 14,
    lineHeight: 20,
  },
  benefitRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  benefitText: {
    color: "#5E6573",
    fontSize: 14,
  },
  proSpark: {
    position: "absolute",
    right: 28,
    top: 64,
  },
  proButton: {
    marginTop: 18,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7C828F",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  proButtonText: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "600",
  },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 12,
    color: "#111111",
    fontSize: 18,
    fontWeight: "700",
  },
  settingsCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ECEEF2",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  settingsRow: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#ECEEF2",
  },
  settingsLabel: {
    flex: 1,
    marginLeft: 14,
    color: "#111111",
    fontSize: 16,
  },
});
