import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import { SafeAreaView } from "react-native-safe-area-context";
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
  onDeleteAccount: () => Promise<void> | void;
};

const OTA_DEBUG_JS_LABEL = "Fix apple pay JWS";

export function MeScreen({ isActive, onOpenPro, onOpenAbout, onLogout, onDeleteAccount }: MeScreenProps) {
  const { isMounted } = useMountedGuard();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [isLoadingEntitlement, setIsLoadingEntitlement] = useState(true);
  const [updatesDebugVisible, setUpdatesDebugVisible] = useState(false);
  const [updatesTapCount, setUpdatesTapCount] = useState(0);
  const [updatesAction, setUpdatesAction] = useState<string | null>(null);
  const [updatesResult, setUpdatesResult] = useState("尚未执行操作");

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
  const isAdmin = session?.user.role === "admin";
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
        <Pressable style={styles.profileRow} onPress={() => {
          if (!isAdmin) return;
          setUpdatesTapCount((count) => {
            const next = count + 1;
            if (next >= 6) {
              setUpdatesDebugVisible(true);
              return 0;
            }
            return next;
          });
        }}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>OIO</Text>
          </View>
          <View style={styles.profileBody}>
            <Text style={styles.profileName}>{userName}</Text>
            <Text style={styles.profilePlan}>{planLabel}</Text>
          </View>
        </Pressable>

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
          <Text style={styles.proSubtitle}>给常练的人多一点空间</Text>
          {["更多每日字符额度", "云端同步"].map((item) => (
            <View key={item} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#746BFF" />
              <Text style={styles.benefitText}>{item}</Text>
            </View>
          ))}
          <Pressable style={styles.proButton} onPress={onOpenPro}>
            <Text style={styles.proButtonText}>了解 Pro</Text>
            <Ionicons name="chevron-forward" size={20} color="#111111" />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>更多</Text>
        <View style={styles.settingsCard}>
          <SettingsRow icon="information-circle-outline" label="关于 OIO" onPress={onOpenAbout} />
          <SettingsRow icon="log-out-outline" label="退出登录" onPress={onLogout} />
          <SettingsRow icon="person-remove-outline" label="注销账号" onPress={onDeleteAccount} tone="danger" isLast />
        </View>
      </ScrollView>
      <UpdatesDebugModal
        visible={updatesDebugVisible}
        runningAction={updatesAction}
        result={updatesResult}
        onClose={() => setUpdatesDebugVisible(false)}
        onRun={async (label, action) => {
          setUpdatesAction(label);
          setUpdatesResult(`${label}...`);
          try {
            const result = await action();
            setUpdatesResult(formatDebugValue(result));
          } catch (error) {
            setUpdatesResult(formatError(error));
          } finally {
            setUpdatesAction(null);
          }
        }}
      />
    </SafeAreaView>
  );
}

function UpdatesDebugModal({
  visible,
  runningAction,
  result,
  onClose,
  onRun,
}: {
  visible: boolean;
  runningAction: string | null;
  result: string;
  onClose: () => void;
  onRun: (label: string, action: () => Promise<unknown>) => void;
}) {
  const statusRows = [
    ["jsLabel", OTA_DEBUG_JS_LABEL],
    ["enabled", String(Updates.isEnabled)],
    ["channel", Updates.channel ?? "null"],
    ["runtime", Updates.runtimeVersion ?? "null"],
    ["updateId", Updates.updateId ?? "null"],
    ["message", getUpdateMessage(Updates.manifest)],
    ["embedded", String(Updates.isEmbeddedLaunch)],
    ["emergency", String(Updates.isEmergencyLaunch)],
    ["emergencyReason", Updates.emergencyLaunchReason ?? "null"],
    ["createdAt", Updates.createdAt?.toISOString?.() ?? "null"],
    ["checkAutomatically", Updates.checkAutomatically ?? "null"],
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.updatesDebugBackdrop}>
        <View style={styles.updatesDebugPanel}>
          <View style={styles.updatesDebugHeader}>
            <Text style={styles.updatesDebugTitle}>EAS Update 诊断</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#111111" />
            </Pressable>
          </View>
          <ScrollView style={styles.updatesDebugBody} contentContainerStyle={styles.updatesDebugContent}>
            {statusRows.map(([label, value]) => (
              <View key={label} style={styles.updatesDebugRow}>
                <Text style={styles.updatesDebugLabel}>{label}</Text>
                <Text selectable style={styles.updatesDebugValue}>{value}</Text>
              </View>
            ))}
            <View style={styles.updatesDebugActions}>
              <DebugButton label="检查更新" disabled={!!runningAction} onPress={() => onRun("check", Updates.checkForUpdateAsync)} />
              <DebugButton label="下载更新" disabled={!!runningAction} onPress={() => onRun("fetch", Updates.fetchUpdateAsync)} />
              <DebugButton label="重载应用" disabled={!!runningAction} onPress={() => onRun("reload", Updates.reloadAsync)} />
              <DebugButton label="读取日志" disabled={!!runningAction} onPress={() => onRun("logs", () => Updates.readLogEntriesAsync(24 * 60 * 60 * 1000))} />
            </View>
            <Text style={styles.updatesDebugResultTitle}>结果</Text>
            <Text selectable style={styles.updatesDebugResult}>{runningAction ? `${runningAction} running...\n\n` : ""}{result}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DebugButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.updatesDebugButton, disabled && styles.updatesDebugButtonDisabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.updatesDebugButtonText}>{label}</Text>
    </Pressable>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  isLast,
  tone = "default",
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void | Promise<void>;
  isLast?: boolean;
  tone?: "default" | "danger";
}) {
  const color = tone === "danger" ? "#C43D3D" : "#111111";

  return (
    <Pressable style={[styles.settingsRow, !isLast && styles.settingsRowBorder]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.settingsLabel, tone === "danger" && styles.settingsLabelDanger]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={color} />
    </Pressable>
  );
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

function formatDebugValue(value: unknown): string {
  const updateMessage = getResultUpdateMessage(value);
  const formatted = JSON.stringify(value, null, 2) ?? String(value);
  return updateMessage === "null" ? formatted : `message: ${updateMessage}\n\n${formatted}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`.trim();
  }
  return formatDebugValue(error);
}

function getResultUpdateMessage(value: unknown): string {
  if (!isRecord(value)) return "null";
  return getUpdateMessage(value.manifest);
}

function getUpdateMessage(manifest: unknown): string {
  if (!isRecord(manifest)) return "null";
  const candidates = [
    manifest.metadata,
    manifest.extra,
    manifest,
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const direct = readStringField(candidate, ["message", "updateMessage", "easUpdateMessage"]);
    if (direct) return direct;
    const eas = candidate.eas;
    if (isRecord(eas)) {
      const nested = readStringField(eas, ["message", "updateMessage", "easUpdateMessage"]);
      if (nested) return nested;
    }
  }
  return "null";
}

function readStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },
  scroller: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  profileRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  profileAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: "#E2DFFF",
    backgroundColor: "#F0EDFF",
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    color: "#343041",
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  profileBody: {
    marginLeft: 14,
  },
  profileName: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
  },
  profilePlan: {
    marginTop: 4,
    color: "#606780",
    fontSize: 13,
  },

  quotaCard: {
    marginTop: 18,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E4DD",
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
    color: "#746BFF",
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
    backgroundColor: "#746BFF",
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
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2DFFF",
    backgroundColor: "#F7F5FF",
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
    borderColor: "#D6D1F4",
    backgroundColor: "rgba(255,255,255,0.72)",
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
    borderColor: "#E5E4DD",
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
  settingsLabelDanger: {
    color: "#C43D3D",
  },
  updatesDebugBackdrop: {
    flex: 1,
    padding: 18,
    backgroundColor: "rgba(0,0,0,0.32)",
    justifyContent: "center",
  },
  updatesDebugPanel: {
    maxHeight: "86%",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  updatesDebugHeader: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#ECEEF2",
    flexDirection: "row",
    alignItems: "center",
  },
  updatesDebugTitle: {
    flex: 1,
    color: "#111111",
    fontSize: 16,
    fontWeight: "600",
  },
  updatesDebugBody: {
    maxHeight: "100%",
  },
  updatesDebugContent: {
    padding: 14,
  },
  updatesDebugRow: {
    marginBottom: 8,
  },
  updatesDebugLabel: {
    color: "#606780",
    fontSize: 11,
  },
  updatesDebugValue: {
    marginTop: 2,
    color: "#111111",
    fontSize: 12,
  },
  updatesDebugActions: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  updatesDebugButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#F0ECFF",
    justifyContent: "center",
  },
  updatesDebugButtonDisabled: {
    opacity: 0.5,
  },
  updatesDebugButtonText: {
    color: "#111111",
    fontSize: 13,
    fontWeight: "600",
  },
  updatesDebugResultTitle: {
    marginTop: 14,
    color: "#606780",
    fontSize: 12,
    fontWeight: "600",
  },
  updatesDebugResult: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#F7F8FB",
    color: "#111111",
    fontSize: 11,
  },
});
