import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession, type AuthSession } from "../services/auth/authStorage";
import {
  getUserPreference,
  updateUserPreference,
  type AppLocale,
  type CurrentEntitlement,
  type LearningLanguage,
  type PromptDifficulty,
  type PromptStyle,
  type UserPreference,
} from "../services/api/meApi";
import { getCachedEntitlementForUser, isSameEntitlement } from "../services/entitlement/entitlementCache";
import { refreshEntitlementAndSessionSafe } from "../services/entitlement/entitlementSync";
import { recoverPendingPaymentIfAny } from "../services/payment/paymentRecovery";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { setLanguage, t, tf } from "../i18n";
import { DebugPromptModal } from "./shared/DebugPromptModal";
import { listTtsVoices, type TtsVoiceOption } from "../services/api/ttsApi";
import { getLogs, type AppLog } from "../services/logger";

type MeScreenProps = {
  isActive: boolean;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onOpenHelp: () => void;
  onLogout: () => Promise<void> | void;
  onDeleteAccount: () => Promise<void> | void;
};

const OTA_DEBUG_JS_LABEL = "Dictionary overlay close fix";
const UPDATE_LOG_KEYWORDS = ["error", "fail", "exception", "crash", "rollback", "emergency", "launch", "reset", "delete"];
const UPDATE_ID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function MeScreen({ isActive, onOpenPro, onOpenAbout, onOpenHelp, onLogout, onDeleteAccount }: MeScreenProps) {
  const { isMounted } = useMountedGuard();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [preference, setPreference] = useState<UserPreference | null>(null);
  const [languageSettingsVisible, setLanguageSettingsVisible] = useState(false);
  const [devDebugVisible, setDevDebugVisible] = useState(false);
  const [aiDebugVisible, setAiDebugVisible] = useState(false);
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
      const localSession = await getSession();
      const [cached, localPreference] = await Promise.all([
        localSession?.user.id ? getCachedEntitlementForUser(localSession.user.id) : Promise.resolve(null),
        localSession ? getUserPreference().catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled || !isMounted()) return;
      setSession(localSession);
      if (cached) setEntitlement(cached.data);
      if (localPreference) setPreference(localPreference);
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
    const dailyTotalLimit = entitlement?.dailyTotalLimit ?? (session?.sessionFlags?.isPro ? 10000 : 10000);
    const remainingChars = entitlement?.remainingChars ?? null;
    const ratio = remainingChars === null || dailyTotalLimit <= 0 ? 0 : remainingChars / dailyTotalLimit;

    // 进度条只接受 0-1，避免异常数据把布局撑出容器。
    return { dailyTotalLimit, remainingChars, ratio: Math.max(0, Math.min(1, ratio)) };
  }, [entitlement, session?.sessionFlags?.isPro]);

  const userName = resolveUserName(session);
  const isAdmin = session?.user.role === "admin";
  const isMember = entitlement ? (entitlement.isMember ?? entitlement.isPro) : session?.sessionFlags?.isPro === true;
  const planLabel = resolvePlanLabel(entitlement, session);
  const quotaTitle = isMember ? t("me.quota.pro_title") : t("me.quota.free_title");
  const quotaLabel = isMember ? t("me.quota.pro_label") : t("me.quota.free_label");
  const quotaResetText = isMember
    ? t("me.quota.reset_daily")
    : entitlement?.validUntil
      ? tf("me.quota.valid_until", { time: formatDateTime(entitlement.validUntil) })
      : t("me.quota.free_valid");

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroller} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.profileRow} onPress={() => {
          if (!isAdmin) return;
          setUpdatesTapCount((count) => {
            const next = count + 1;
            if (next >= 6) {
              setDevDebugVisible(true);
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
            <Text style={styles.quotaUnit}>{t("me.quota.unit")}</Text>
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
          <Text style={styles.proTitle}>{t("me.pro.title")}</Text>
          <Text style={styles.proSubtitle}>{t("me.pro.subtitle")}</Text>
          {([t("me.pro.benefit.quota"), t("me.pro.benefit.cloud"), t("me.pro.benefit.tts")]).map((item) => (
            <View key={item} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#746BFF" />
              <Text style={styles.benefitText}>{item}</Text>
            </View>
          ))}
          <Pressable style={styles.proButton} onPress={onOpenPro}>
            <Text style={styles.proButtonText}>{t("me.pro.learn_more")}</Text>
            <Ionicons name="chevron-forward" size={20} color="#111111" />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t("me.section.more")}</Text>
        <View style={styles.settingsCard}>
          <SettingsRow
            icon="language-outline"
            label={t("me.language_settings")}
            value={preference ? [
              appLocaleLabel(preference.appLocale),
              learningLanguageLabel(preference.learningLanguage),
              promptDifficultyLabel(preference.promptDifficulty),
              promptStyleLabel(preference.promptStyle, preference.learningLanguage),
            ].join(" · ") : undefined}
            onPress={() => setLanguageSettingsVisible(true)}
          />
          <SettingsRow icon="help-circle-outline" label={t("me.help")} onPress={onOpenHelp} />
          <SettingsRow icon="information-circle-outline" label={t("me.about")} onPress={onOpenAbout} />
          <SettingsRow icon="log-out-outline" label={t("me.logout")} onPress={onLogout} />
          <SettingsRow icon="person-remove-outline" label={t("me.delete_account")} onPress={onDeleteAccount} tone="danger" isLast />
        </View>
      </ScrollView>
      <LanguageSettingsModal
        visible={languageSettingsVisible}
        preference={preference}
        onClose={() => setLanguageSettingsVisible(false)}
        onSave={async (next) => {
          try {
            const saved = await updateUserPreference(next);
            await setLanguage(saved.appLocale);
            setPreference(saved);
            setLanguageSettingsVisible(false);
          } catch {
            Alert.alert(t("me.language.save_failed_title"), t("me.language.save_failed_message"));
          }
        }}
      />
      <DeveloperDebugModal
        visible={devDebugVisible}
        onClose={() => setDevDebugVisible(false)}
        onOpenAiDebug={() => {
          setDevDebugVisible(false);
          setAiDebugVisible(true);
        }}
        onOpenUpdatesDebug={() => {
          setDevDebugVisible(false);
          setUpdatesDebugVisible(true);
        }}
      />
      <DebugPromptModal visible={aiDebugVisible} onClose={() => setAiDebugVisible(false)} />
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
            setUpdatesResult(
              label === "logs"
                ? formatCombinedDiagnostics(result)
                : formatUpdateActionResult(label, result),
            );
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

function LanguageSettingsModal({
  visible,
  preference,
  onClose,
  onSave,
}: {
  visible: boolean;
  preference: UserPreference | null;
  onClose: () => void;
  onSave: (next: {
    appLocale: AppLocale;
    learningLanguage: LearningLanguage;
    promptDifficulty: PromptDifficulty;
    promptStyle: PromptStyle;
    ttsVoiceCode: string;
  }) => Promise<void>;
}) {
  const [appLocale, setAppLocale] = useState<AppLocale>("zh-CN");
  const [learningLanguage, setLearningLanguage] = useState<LearningLanguage>("en-US");
  const [promptDifficulty, setPromptDifficulty] = useState<PromptDifficulty>("natural");
  const [promptStyle, setPromptStyle] = useState<PromptStyle>("native_casual");
  const [ttsVoiceCode, setTtsVoiceCode] = useState("");
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentLanguageVoiceOptions = ttsVoiceOptions.filter((option) => option.languageCode === learningLanguage);
  const canSave = !saving && currentLanguageVoiceOptions.some((option) => option.voiceCode === ttsVoiceCode);

  useEffect(() => {
    if (!visible) return;
    const nextLearningLanguage = preference?.learningLanguage ?? "en-US";
    setAppLocale(preference?.appLocale ?? "zh-CN");
    setLearningLanguage(nextLearningLanguage);
    setPromptDifficulty(preference?.promptDifficulty ?? "natural");
    setPromptStyle(preference?.promptStyle ?? "native_casual");
  }, [preference, visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setVoiceLoading(true);
    setVoiceError(false);
    listTtsVoices()
      .then((options) => {
        if (cancelled) return;
        setTtsVoiceOptions(options);
        setTtsVoiceCode(resolveTtsVoiceCodeForLanguage(options, learningLanguage, preference?.ttsVoiceCode));
      })
      .catch(() => {
        if (cancelled) return;
        setTtsVoiceOptions([]);
        setTtsVoiceCode("");
        setVoiceError(true);
      })
      .finally(() => {
        if (!cancelled) setVoiceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [learningLanguage, preference?.ttsVoiceCode, visible]);

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ appLocale, learningLanguage, promptDifficulty, promptStyle, ttsVoiceCode });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.languageBackdrop}>
        <View style={styles.languagePanel}>
          <View style={styles.languageHeader}>
            <Text style={styles.languageTitle}>{t("me.language_settings")}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#111111" />
            </Pressable>
          </View>
          <Text style={styles.languageFieldTitle}>{t("me.language.app_locale")}</Text>
          <View style={styles.languageOptionGrid}>
            {APP_LOCALE_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={t(option.labelKey)}
                active={appLocale === option.value}
                onPress={() => setAppLocale(option.value)}
              />
            ))}
          </View>
          <Text style={styles.languageFieldTitle}>{t("me.language.learning")}</Text>
          <Text style={styles.languageHint}>{t("me.language.hint")}</Text>
          <View style={styles.languageOptionGrid}>
            {LEARNING_LANGUAGE_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={t(option.labelKey)}
                active={learningLanguage === option.value}
                onPress={() => {
                  setLearningLanguage(option.value);
                  setTtsVoiceCode(resolveTtsVoiceCodeForLanguage(ttsVoiceOptions, option.value, null));
                }}
              />
            ))}
          </View>
          <Text style={styles.languageFieldTitle}>{t("me.language.difficulty")}</Text>
          <Text style={styles.languageHint}>{t("me.language.difficulty_hint")}</Text>
          <View style={styles.languageOptionGrid}>
            {PROMPT_DIFFICULTY_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={t(option.labelKey)}
                active={promptDifficulty === option.value}
                onPress={() => setPromptDifficulty(option.value)}
              />
            ))}
          </View>
          <Text style={styles.languageFieldTitle}>{t("me.language.style")}</Text>
          <Text style={styles.languageHint}>{t("me.language.style_hint")}</Text>
          <View style={styles.languageOptionGrid}>
            {PROMPT_STYLE_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={option.value === "native_casual"
                  ? t(learningLanguage === "ja-JP" ? "prompt_style.native_casual.ja" : "prompt_style.native_casual.en")
                  : t(option.labelKey)}
                active={promptStyle === option.value}
                onPress={() => setPromptStyle(option.value)}
              />
            ))}
          </View>
          <Text style={styles.languageFieldTitle}>{t("me.language.tts_voice")}</Text>
          <Text style={styles.languageHint}>{t("me.language.tts_voice_hint")}</Text>
          <View style={styles.languageOptionGrid}>
            {voiceLoading ? <ActivityIndicator size="small" color="#1F6FEB" /> : null}
            {voiceError ? <Text style={styles.languageHint}>{t("tts.error.failed")}</Text> : null}
            {!voiceLoading && !voiceError && currentLanguageVoiceOptions.map((option) => (
              <VoiceOptionChip
                key={option.voiceCode}
                languageLabel={learningLanguageLabel(option.languageCode as LearningLanguage)}
                label={option.label}
                active={ttsVoiceCode === option.voiceCode}
                onPress={() => setTtsVoiceCode(option.voiceCode)}
              />
            ))}
          </View>
          <View style={styles.languageActions}>
            <Pressable style={styles.languageCancelButton} onPress={onClose} disabled={saving}>
              <Text style={styles.languageCancelText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable style={[styles.languageSaveButton, !canSave && styles.languageButtonDisabled]} onPress={() => void handleSave()} disabled={!canSave}>
              <Text style={styles.languageSaveText}>{saving ? t("common.saving") : t("common.save")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VoiceOptionChip({
  languageLabel,
  label,
  active,
  onPress,
}: {
  languageLabel: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.voiceOptionChip, active && styles.languageOptionChipActive]} onPress={onPress}>
      <Text style={[styles.voiceOptionTag, active && styles.voiceOptionTagActive]}>{languageLabel}</Text>
      <Text style={[styles.voiceOptionText, active && styles.languageOptionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DeveloperDebugModal({
  visible,
  onClose,
  onOpenAiDebug,
  onOpenUpdatesDebug,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenAiDebug: () => void;
  onOpenUpdatesDebug: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.languageBackdrop}>
        <View style={styles.devDebugPanel}>
          <View style={styles.languageHeader}>
            <Text style={styles.languageTitle}>开发调试</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#111111" />
            </Pressable>
          </View>
          <View style={styles.settingsCard}>
            <SettingsRow icon="sparkles-outline" label="AI 调试设置" onPress={onOpenAiDebug} />
            <SettingsRow icon="cloud-download-outline" label="EAS Update 诊断" onPress={onOpenUpdatesDebug} isLast />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function OptionChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.languageOptionChip, active && styles.languageOptionChipActive]} onPress={onPress}>
      <Text style={[styles.languageOptionText, active && styles.languageOptionTextActive]}>{label}</Text>
    </Pressable>
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
              <DebugButton label="重载(谨慎)" disabled={!!runningAction} onPress={() => onRun("reload", Updates.reloadAsync)} />
              <DebugButton label="读取日志" disabled={!!runningAction} onPress={() => onRun("logs", readCombinedDiagnostics)} />
            </View>
            <Text style={styles.updatesDebugHint}>下载后优先从系统后台划掉 App 再手动打开；只有需要验证 reloadAsync 时再点重载。</Text>
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

async function readCombinedDiagnostics(): Promise<{ updateLogs: unknown; appLogs: AppLog[] }> {
  const [updateLogs, appLogs] = await Promise.all([
    Updates.readLogEntriesAsync(24 * 60 * 60 * 1000),
    getLogs(),
  ]);
  return { updateLogs, appLogs };
}

function formatCombinedDiagnostics(value: unknown): string {
  if (!isRecord(value)) return formatDebugValue(value);
  return [
    formatAppLogs(value.appLogs),
    "",
    formatUpdateLogs(value.updateLogs),
  ].join("\n");
}

function formatUpdateLogs(value: unknown): string {
  if (!Array.isArray(value)) return formatDebugValue(value);
  const rows = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const rawMessage = typeof record.message === "string" ? record.message : "";
      const message = summarizeUpdateLogMessage(rawMessage);
      const level = typeof record.level === "string" ? record.level : "unknown";
      const code = typeof record.code === "string" ? record.code : "None";
      const timestamp = typeof record.timestamp === "number" ? new Date(record.timestamp).toISOString() : String(record.timestamp ?? "");
      return {
        level,
        code,
        timestamp,
        message,
        searchable: `${level} ${code} ${message}`.toLowerCase(),
      };
    })
    .filter((entry): entry is { level: string; code: string; timestamp: string; message: string; searchable: string } => !!entry);
  const important = rows.filter((entry) => UPDATE_LOG_KEYWORDS.some((keyword) => entry.searchable.includes(keyword)));
  const recent = rows.slice(-12);
  return [
    `important logs (${important.length}/${rows.length})`,
    ...important.slice(-24).map(formatUpdateLogLine),
    "",
    "recent logs",
    ...recent.map(formatUpdateLogLine),
  ].join("\n");
}

function formatUpdateLogLine(entry: { level: string; code: string; timestamp: string; message: string }): string {
  return `[${entry.level}/${entry.code}] ${entry.timestamp}\n${entry.message}`;
}

function formatAppLogs(value: unknown): string {
  if (!Array.isArray(value)) return formatDebugValue(value);
  const rows = value.filter((entry): entry is AppLog => isRecord(entry) && typeof entry.event === "string");
  const important = rows.filter((entry) => entry.level === "error" || /update|error|crash|fatal|global/i.test(entry.event));
  const recent = rows.slice(-6);
  return [
    `app failures (${important.length}/${rows.length})`,
    ...important.slice(-8).map(formatAppLogLine),
    "",
    "recent app",
    ...recent.map(formatAppLogLine),
  ].join("\n");
}

function formatAppLogLine(entry: AppLog): string {
  const extra = entry.extra ? `\n${JSON.stringify(entry.extra, null, 2).slice(0, 420)}` : "";
  return `[${entry.level}] ${entry.time}\n${entry.event}${entry.message ? `: ${entry.message}` : ""}${extra}`;
}

function formatUpdateActionResult(label: string, value: unknown): string {
  if (label === "reload") {
    return "reloadAsync called. If the app closes or returns to embedded, read logs after reopening.";
  }
  if (!isRecord(value)) return formatDebugValue(value);
  const lines = [`${label} result`];
  for (const key of ["isAvailable", "isNew", "isRollBackToEmbedded"] as const) {
    if (key in value) lines.push(`${key}: ${String(value[key])}`);
  }
  const manifest = isRecord(value.manifest) ? value.manifest : null;
  if (manifest) {
    const metadata = isRecord(manifest.metadata) ? manifest.metadata : null;
    const extra = isRecord(manifest.extra) ? manifest.extra : null;
    lines.push(`id: ${String(manifest.id ?? "null")}`);
    lines.push(`createdAt: ${String(manifest.createdAt ?? "null")}`);
    lines.push(`runtimeVersion: ${String(manifest.runtimeVersion ?? "null")}`);
    lines.push(`branch: ${String(metadata?.branchName ?? "null")}`);
    lines.push(`group: ${String(metadata?.updateGroup ?? "null")}`);
    lines.push(`message: ${getUpdateMessage(manifest)}`);
    if (extra && isRecord(extra.eas)) lines.push(`projectId: ${String(extra.eas.projectId ?? "null")}`);
  }
  return lines.join("\n");
}

function summarizeUpdateLogMessage(rawMessage: string): string {
  const compact = rawMessage.replace(/\s+/g, " ").trim();
  if (compact.length <= 360) return compact;
  const pieces: string[] = [];
  const stateMatch = compact.match(/state = [^,)]*/);
  const eventMatch = compact.match(/event = [^,)]*/);
  const failureMatch = compact.match(/failureCount = \d+/);
  const updateGroups = collectRegexMatches(compact, /updateGroup = "?([0-9a-f-]{36})"?/gi);
  const ids = Array.from(new Set(compact.match(UPDATE_ID_PATTERN) ?? []));
  const flags = [
    "isStartupProcedureRunning",
    "isUpdateAvailable",
    "isUpdatePending",
    "isChecking",
    "isDownloading",
    "isRestarting",
  ]
    .map((key) => compact.match(new RegExp(`${key}: (true|false)`, "i"))?.[0])
    .filter((item): item is string => !!item);
  if (stateMatch) pieces.push(stateMatch[0]);
  if (eventMatch) pieces.push(eventMatch[0]);
  if (failureMatch) pieces.push(failureMatch[0]);
  if (updateGroups.length) pieces.push(`groups: ${updateGroups.slice(-3).join(", ")}`);
  if (ids.length) pieces.push(`ids: ${ids.slice(-4).join(", ")}`);
  if (flags.length) pieces.push(flags.join(", "));
  if (/checkError: nil/i.test(compact)) pieces.push("checkError: nil");
  if (/downloadError: nil/i.test(compact)) pieces.push("downloadError: nil");
  if (/Deleted assets and updates/i.test(compact)) pieces.push(compact.slice(0, 180));
  return pieces.length ? pieces.join("\n") : `${compact.slice(0, 340)}...`;
}

function collectRegexMatches(value: string, pattern: RegExp): string[] {
  const output: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const item = match[1];
    if (item && !output.includes(item)) output.push(item);
  }
  return output;
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  isLast,
  tone = "default",
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value?: string;
  onPress: () => void | Promise<void>;
  isLast?: boolean;
  tone?: "default" | "danger";
}) {
  const color = tone === "danger" ? "#C43D3D" : "#111111";

  return (
    <Pressable style={[styles.settingsRow, !isLast && styles.settingsRowBorder]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.settingsLabel, tone === "danger" && styles.settingsLabelDanger]}>{label}</Text>
      {value ? <Text style={styles.settingsValue} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={color} />
    </Pressable>
  );
}

const APP_LOCALE_OPTIONS: Array<{ value: AppLocale; labelKey: Parameters<typeof t>[0] }> = [
  { value: "zh-CN", labelKey: "language.zh_cn" },
  { value: "zh-TW", labelKey: "language.zh_tw" },
  { value: "en-US", labelKey: "language.en_us" },
  { value: "ja-JP", labelKey: "language.ja_jp" },
];

const LEARNING_LANGUAGE_OPTIONS: Array<{ value: LearningLanguage; labelKey: Parameters<typeof t>[0] }> = [
  { value: "en-US", labelKey: "learning.en_us" },
  { value: "ja-JP", labelKey: "learning.ja_jp" },
];

const PROMPT_DIFFICULTY_OPTIONS: Array<{ value: PromptDifficulty; labelKey: Parameters<typeof t>[0] }> = [
  { value: "simple", labelKey: "prompt_difficulty.simple" },
  { value: "natural", labelKey: "prompt_difficulty.natural" },
  { value: "native", labelKey: "prompt_difficulty.native" },
];

const PROMPT_STYLE_OPTIONS: Array<{ value: PromptStyle; labelKey: Parameters<typeof t>[0] }> = [
  { value: "native_casual", labelKey: "prompt_style.native_casual.en" },
  { value: "standard", labelKey: "prompt_style.standard" },
];

function resolveTtsVoiceCodeForLanguage(
  options: TtsVoiceOption[],
  languageCode: LearningLanguage,
  voiceCode: string | null | undefined
): string {
  const languageOptions = options.filter((option) => option.languageCode === languageCode);
  if (voiceCode && languageOptions.some((option) => option.voiceCode === voiceCode)) {
    return voiceCode;
  }
  return languageOptions.find((option) => option.isDefault)?.voiceCode ?? languageOptions[0]?.voiceCode ?? "";
}

function appLocaleLabel(value: AppLocale): string {
  const option = APP_LOCALE_OPTIONS.find((item) => item.value === value) ?? APP_LOCALE_OPTIONS[0];
  return t(option.labelKey);
}

function learningLanguageLabel(value: LearningLanguage): string {
  const option = LEARNING_LANGUAGE_OPTIONS.find((item) => item.value === value) ?? LEARNING_LANGUAGE_OPTIONS[0];
  return t(option.labelKey);
}

function promptDifficultyLabel(value: PromptDifficulty): string {
  const option = PROMPT_DIFFICULTY_OPTIONS.find((item) => item.value === value) ?? PROMPT_DIFFICULTY_OPTIONS[1];
  return t(option.labelKey);
}

function promptStyleLabel(value: PromptStyle, learningLanguage: LearningLanguage): string {
  if (value === "native_casual") {
    return t(learningLanguage === "ja-JP" ? "prompt_style.native_casual.ja" : "prompt_style.native_casual.en");
  }
  return t("prompt_style.standard");
}

function resolvePlanLabel(entitlement: CurrentEntitlement | null, session: AuthSession | null): string {
  if (entitlement?.tier === "plus") return t("me.plan.plus");
  if (entitlement?.tier === "pro") return t("me.plan.pro");
  if (entitlement?.isMember ?? entitlement?.isPro) return t("me.plan.member");
  if (session?.sessionFlags?.isPro === true) return t("me.plan.member");
  return t("me.plan.free");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function resolveUserName(session: AuthSession | null): string {
  if (!session) return "";
  const user = session.user as AuthSession["user"] & { username?: string | null };
  return user.displayName?.trim() || user.username?.trim() || user.email?.trim() || user.phone?.trim() || "";
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
  settingsValue: {
    maxWidth: 160,
    marginRight: 8,
    color: "#7E8491",
    fontSize: 13,
  },
  settingsLabelDanger: {
    color: "#C43D3D",
  },
  languageBackdrop: {
    flex: 1,
    paddingHorizontal: 18,
    backgroundColor: "rgba(0,0,0,0.32)",
    justifyContent: "center",
  },
  languagePanel: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  devDebugPanel: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  languageHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
  },
  languageTitle: {
    flex: 1,
    color: "#111111",
    fontSize: 18,
    fontWeight: "600",
  },
  languageFieldTitle: {
    marginTop: 16,
    color: "#343A45",
    fontSize: 13,
    fontWeight: "700",
  },
  languageHint: {
    marginTop: 6,
    color: "#7E8491",
    fontSize: 12,
    lineHeight: 17,
  },
  languageOptionGrid: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  languageOptionChip: {
    minHeight: 38,
    minWidth: 90,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  languageOptionChipActive: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  languageOptionText: {
    color: "#5D6470",
    fontSize: 13,
    fontWeight: "600",
  },
  languageOptionTextActive: {
    color: "#FFFFFF",
  },
  voiceOptionChip: {
    minHeight: 48,
    minWidth: 124,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
  },
  voiceOptionTag: {
    color: "#7E8491",
    fontSize: 11,
    fontWeight: "600",
  },
  voiceOptionTagActive: {
    color: "rgba(255,255,255,0.72)",
  },
  voiceOptionText: {
    marginTop: 2,
    color: "#343A45",
    fontSize: 13,
    fontWeight: "700",
  },
  languageActions: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10,
  },
  languageCancelButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8DAE0",
    alignItems: "center",
    justifyContent: "center",
  },
  languageSaveButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  languageButtonDisabled: {
    opacity: 0.62,
  },
  languageCancelText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "600",
  },
  languageSaveText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
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
  updatesDebugHint: {
    marginTop: 8,
    color: "#7E8491",
    fontSize: 11,
    lineHeight: 16,
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
