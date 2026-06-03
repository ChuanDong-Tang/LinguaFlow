import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";
import { getSession, type AuthSession } from "../services/auth/authStorage";
import type { CurrentEntitlement } from "../services/api/meApi";
import { getCachedEntitlement, isSameEntitlement } from "../services/entitlement/entitlementCache";
import { refreshEntitlementAndSessionSafe } from "../services/entitlement/entitlementSync";
import { recoverPendingPaymentIfAny } from "../services/payment/paymentRecovery";
import { useMountedGuard } from "../hooks/useMountedGuard";

type MeScreenProps = {
  isActive: boolean;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void> | void;
};

export function MeScreen({ isActive, onOpenPro, onOpenAbout, onLogout }: MeScreenProps) {
  const { isMounted } = useMountedGuard();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [isLoadingEntitlement, setIsLoadingEntitlement] = useState(true);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    async function loadProfile() {
      // 先恢复支付状态，再读取会话和权益，保证个人页展示尽量接近最新状态。
      if (isMounted()) setIsLoadingEntitlement(true);
      await recoverPendingPaymentIfAny();
      const [localSession, cached] = await Promise.all([getSession(), getCachedEntitlement()]);
      if (cancelled || !isMounted()) return;
      setSession(localSession);
      if (cached) setEntitlement(cached.data);
      setIsLoadingEntitlement(!cached);
      try {
        const refreshed = await refreshEntitlementAndSessionSafe();
        if (!cancelled && isMounted() && refreshed) {
          const data = refreshed.entitlement;
          setEntitlement((prev) => (isSameEntitlement(prev, data) ? prev : data));
        }
      } catch {
      } finally {
        if (!cancelled && isMounted()) setIsLoadingEntitlement(false);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [isActive, isMounted]);

  const quota = useMemo(() => {
    const dailyTotalLimit = entitlement?.dailyTotalLimit ?? (session?.sessionFlags?.isPro ? 100000 : 10000);
    const remainingChars = entitlement?.remainingChars ?? null;
    const ratio = remainingChars === null || dailyTotalLimit <= 0 ? 0 : remainingChars / dailyTotalLimit;

    // 进度条只接受 0-1，避免异常数据把布局撑出容器。
    return { dailyTotalLimit, remainingChars, ratio: Math.max(0, Math.min(1, ratio)) };
  }, [entitlement, session?.sessionFlags?.isPro]);

  const userName = session?.user.displayName ?? "";
  const planLabel = (entitlement?.isPro ?? session?.sessionFlags?.isPro === true) ? "Pro" : "普通版";
  const quotaTitle = entitlement?.isPro ? "今日字符额度" : "免费字符额度";
  const quotaLabel = entitlement?.isPro ? "今日剩余" : "剩余额度";
  const quotaResetText = entitlement?.isPro
    ? "每天 24:00 自动恢复"
    : entitlement?.validUntil
      ? `有效期至 ${formatDateTime(entitlement.validUntil)}`
      : "首次使用后 7 天内有效";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroller} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileRow}>
          <View style={styles.profileAvatar}>
            <Ionicons name="person-outline" size={38} color="#111111" />
          </View>
          <View style={styles.profileBody}>
            <Text style={styles.profileName}>{userName}</Text>
            <Text style={styles.profilePlan}>{planLabel}</Text>
          </View>
        </View>

        <View style={styles.quotaCard}>
          <Text style={styles.cardTitle}>{quotaTitle}</Text>
          <View style={styles.quotaRow}>
            <Text style={styles.quotaLabel}>{quotaLabel}</Text>
            <Text style={styles.quotaNumber}>{quota.remainingChars === null ? "--" : formatNumber(quota.remainingChars)}</Text>
            <Text style={styles.quotaUnit}>字</Text>
            {isLoadingEntitlement ? <ActivityIndicator size="small" color="#6E63FF" style={styles.quotaLoading} /> : null}
          </View>
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${quota.ratio * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>
              {quota.remainingChars === null ? "--" : formatNumber(quota.remainingChars)} /{" "}
              {formatNumber(quota.dailyTotalLimit)}
            </Text>
          </View>
          <Text style={styles.resetText}>{quotaResetText}</Text>
        </View>

        <View style={styles.proCard}>
          <Text style={styles.proTitle}>OIO Pro</Text>
          <Text style={styles.proSubtitle}>更充足的字符额度，更自由地表达</Text>
          {["更多每日字符额度", "云端同步"].map((item) => (
            <View key={item} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#6E63FF" />
              <Text style={styles.benefitText}>{item}</Text>
            </View>
          ))}
          <Pressable style={styles.proButton} onPress={onOpenPro}>
            <Text style={styles.proButtonText}>查看 Pro</Text>
            <Ionicons name="chevron-forward" size={20} color="#111111" />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>更多</Text>
        <View style={styles.settingsCard}>
          <SettingsRow icon="information-circle-outline" label="关于 OIO" onPress={onOpenAbout} />
          <SettingsRow icon="log-out-outline" label="退出登录" onPress={onLogout} isLast />
        </View>
      </ScrollView>
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
      <Ionicons name={icon} size={20} color="#111111" />
      <Text style={styles.settingsLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color="#111111" />
    </Pressable>
  );
}

function openUrl(url: string): void {
  void Linking.openURL(url);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  scroller: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  profileRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  profileBody: {
    marginLeft: 14,
  },
  profileName: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "500",
  },
  profilePlan: {
    marginTop: 4,
    color: "#606780",
    fontSize: 13,
  },

  quotaCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E1E5EE",
    backgroundColor: "#FFFFFF",
  },
  cardTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  quotaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "baseline",
  },
  quotaLabel: {
    color: "#5F6675",
    fontSize: 12,
  },
  quotaNumber: {
    marginLeft: 8,
    color: "#6E63FF",
    fontSize: 20,
    fontWeight: "500",
  },
  quotaUnit: {
    marginLeft: 4,
    color: "#111111",
    fontSize: 14,
  },
  quotaLoading: {
    marginLeft: 8,
  },
  progressRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#ECEFF5",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#6E63FF",
  },
  progressText: {
    minWidth: 92,
    color: "#5F6675",
    fontSize: 11,
    textAlign: "right",
  },
  resetText: {
    marginTop: 8,
    color: "#5F6675",
    fontSize: 12,
  },

  proCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E1E5EE",
    backgroundColor: "#FFFFFF",
  },
  proTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
  },
  proSubtitle: {
    marginTop: 6,
    color: "#5E6573",
    fontSize: 13,
  },
  benefitRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  benefitText: {
    color: "#5E6573",
    fontSize: 13,
  },
  proButton: {
    marginTop: 10,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CDD2DE",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  proButtonText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "400",
  },

  sectionTitle: {
    marginTop: 12,
    marginBottom: 8,
    color: "#5E6573",
    fontSize: 13,
  },
  settingsCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E1E5EE",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  settingsRow: {
    minHeight: 50,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  settingsRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#ECEEF2",
  },
  settingsLabel: {
    flex: 1,
    marginLeft: 10,
    color: "#111111",
    fontSize: 15,
  },
});
