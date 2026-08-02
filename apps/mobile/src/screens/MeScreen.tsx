import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession, type AuthSession } from "../services/auth/authStorage";
import {
  getUserPreference,
  getUserBindings,
  getUserProfile,
  updateProfileNickname,
  removeProfileAvatar,
  updateUserPreference,
  type AppLocale,
  type CurrentEntitlement,
  type LearningLanguage,
  type PromptDifficulty,
  type UserPreference,
  type UserBindings,
  type UserProfile,
} from "../services/api/meApi";
import { getCachedEntitlementForUser, isSameEntitlement } from "../services/entitlement/entitlementCache";
import { refreshEntitlementAndSessionSafe } from "../services/entitlement/entitlementSync";
import { recoverPendingPaymentIfAny } from "../services/payment/paymentRecovery";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { t, tf } from "../i18n";
import { DebugPromptModal } from "./shared/DebugPromptModal";
import { listTtsVoices, type TtsVoiceOption } from "../services/api/ttsApi";
import { getLogs, type AppLog } from "../services/logger";
import { theme } from "../theme";
import { prepareAndUploadAvatar } from "../services/profile/avatarUpload";
import { TARGET_LANGUAGE_CODES } from "@lf/core/language/targetLanguages";

type MeScreenProps = {
  isActive: boolean;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onOpenHelp: () => void;
  onApplyAppLocale: (value: AppLocale) => void;
  sessionRevision: number;
  onBindEmail: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
  onDeleteAccount: () => Promise<void> | void;
  onClose?: () => void;
};

const OTA_DEBUG_JS_LABEL = "Dictionary overlay close fix";
const UPDATE_LOG_KEYWORDS = ["error", "fail", "exception", "crash", "rollback", "emergency", "launch", "reset", "delete"];
const UPDATE_ID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function MeScreen({ isActive, onOpenPro, onOpenAbout, onOpenHelp, onApplyAppLocale, sessionRevision, onBindEmail, onLogout, onDeleteAccount, onClose }: MeScreenProps) {
  const { isMounted } = useMountedGuard();
  const appLocaleSyncSeqRef = useRef(0);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [preference, setPreference] = useState<UserPreference | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bindings, setBindings] = useState<UserBindings | null>(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [bindingsVisible, setBindingsVisible] = useState(false);
  const [languageSettingsVisible, setLanguageSettingsVisible] = useState(false);
  const [devDebugVisible, setDevDebugVisible] = useState(false);
  const [aiDebugVisible, setAiDebugVisible] = useState(false);
  const [isLoadingEntitlement, setIsLoadingEntitlement] = useState(true);
  const [updatesDebugVisible, setUpdatesDebugVisible] = useState(false);
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
      const [cached, localPreference, remoteProfile, remoteBindings] = await Promise.all([
        localSession?.user.id ? getCachedEntitlementForUser(localSession.user.id) : Promise.resolve(null),
        localSession ? getUserPreference().catch(() => null) : Promise.resolve(null),
        localSession ? getUserProfile().catch(() => null) : Promise.resolve(null),
        localSession ? getUserBindings().catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled || !isMounted()) return;
      setSession(localSession);
      if (cached) setEntitlement(cached.data);
      if (localPreference) setPreference(localPreference);
      if (remoteProfile) setProfile(remoteProfile);
      if (remoteBindings) setBindings(remoteBindings);
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
  }, [isActive, isMounted, sessionRevision]);

  const quota = useMemo(() => {
    const dailyTotalLimit = entitlement?.dailyTotalLimit ?? (session?.sessionFlags?.isPro ? 10000 : 10000);
    const remainingChars = entitlement?.remainingChars ?? null;
    const ratio = remainingChars === null || dailyTotalLimit <= 0 ? 0 : remainingChars / dailyTotalLimit;

    // 进度条只接受 0-1，避免异常数据把布局撑出容器。
    return { dailyTotalLimit, remainingChars, ratio: Math.max(0, Math.min(1, ratio)) };
  }, [entitlement, session?.sessionFlags?.isPro]);

  // Never fall back to raw auth email/phone while the privacy-safe profile is loading.
  const userName = profile?.nickname || "OIO";
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
  const bindingSummary = bindings?.email.bound
    ? bindings.email.maskedValue ?? "已绑定"
    : bindings?.phone.maskedValue ?? "查看";

  return (
    <SafeAreaView style={styles.container}>
      {onClose ? (
        <View style={styles.sheetHeader}>
          <Pressable accessibilityLabel="关闭我的页面" style={styles.sheetClose} onPress={onClose}>
            <Ionicons name="chevron-down" size={24} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.sheetTitle}>我的</Text>
          <View style={styles.sheetClose} />
        </View>
      ) : null}
      <ScrollView style={styles.scroller} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          style={styles.profileRow}
          onPress={() => setProfileVisible(true)}
          onLongPress={() => { if (isAdmin) setDevDebugVisible(true); }}
        >
          <View style={styles.profileAvatar}>
            {profile?.avatar ? <Image source={{ uri: profile.avatar.thumbnailUrl }} style={styles.profileAvatarImage} /> : <Text style={styles.profileAvatarText}>OIO</Text>}
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
            {isLoadingEntitlement ? <ActivityIndicator size="small" color={theme.colors.accentStrong} style={styles.quotaLoading} /> : null}
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
          {([t("me.pro.benefit.quota"), t("me.pro.benefit.cloud"), t("me.pro.benefit.tts")]).map((item) => (
            <View key={item} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.accentStrong} />
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
            icon="link-outline"
            label="绑定信息"
            value={bindingSummary}
            onPress={() => setBindingsVisible(true)}
          />
          <SettingsRow
            icon="language-outline"
            label={t("me.language_settings")}
            value={preference ? [
              appLocaleLabel(preference.appLocale),
              learningLanguageLabel(preference.learningLanguage),
              promptDifficultyLabel(preference.promptDifficulty),
            ].join(" · ") : undefined}
            onPress={() => setLanguageSettingsVisible(true)}
          />
          <SettingsRow icon="help-circle-outline" label={t("me.help")} onPress={onOpenHelp} />
          <SettingsRow icon="information-circle-outline" label={t("me.about")} onPress={onOpenAbout} />
          <SettingsRow icon="log-out-outline" label={t("me.logout")} onPress={onLogout} />
          <SettingsRow icon="person-remove-outline" label={t("me.delete_account")} onPress={onDeleteAccount} tone="danger" isLast />
        </View>
      </ScrollView>
      <ProfileEditModal
        visible={profileVisible}
        profile={profile}
        onClose={() => setProfileVisible(false)}
        onSaved={setProfile}
      />
      <BindingsModal
        visible={bindingsVisible}
        bindings={bindings}
        onClose={() => setBindingsVisible(false)}
        onBindEmail={() => {
          setBindingsVisible(false);
          void onBindEmail();
        }}
      />
      <LanguageSettingsModal
        visible={languageSettingsVisible}
        preference={preference}
        onClose={() => setLanguageSettingsVisible(false)}
        onApplyAppLocale={(value) => {
          appLocaleSyncSeqRef.current += 1;
          const syncSeq = appLocaleSyncSeqRef.current;
          onApplyAppLocale(value);
          setPreference((current) => current ? { ...current, appLocale: value } : current);
          void updateUserPreference({ appLocale: value })
            .then((saved) => {
              if (!isMounted() || appLocaleSyncSeqRef.current !== syncSeq) return;
              setPreference(saved);
            })
            .catch(() => {
              if (!isMounted() || appLocaleSyncSeqRef.current !== syncSeq) return;
              Alert.alert(t("me.language.save_failed_title"), t("me.language.save_failed_message"));
            });
        }}
        onSave={async (next) => {
          try {
            const saved = await updateUserPreference(next);
            onApplyAppLocale(saved.appLocale);
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

function ProfileEditModal({ visible, profile, onClose, onSaved }: {
  visible: boolean;
  profile: UserProfile | null;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
}) {
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);

  useEffect(() => {
    if (visible) setNickname(profile?.nickname ?? "");
  }, [profile?.nickname, visible]);

  async function save(): Promise<void> {
    if (!nickname.trim() || saving) return;
    setSaving(true);
    try {
      onSaved(await updateProfileNickname(nickname));
    } catch (error) {
      Alert.alert("无法保存昵称", error instanceof Error ? error.message : "请稍后再试");
    } finally {
      setSaving(false);
    }
  }

  function chooseAvatar(): void {
    if (avatarSaving) return;
    Alert.alert("更换头像", undefined, [
      { text: "拍照", onPress: () => void pickAvatar("camera") },
      { text: "从相册选择", onPress: () => void pickAvatar("library") },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function pickAvatar(source: "camera" | "library"): Promise<void> {
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("需要图片权限", source === "camera" ? "请允许使用相机后再拍照" : "请允许访问相册后再选择图片");
      return;
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.uri) return;
    setAvatarSaving(true);
    try {
      onSaved(await prepareAndUploadAvatar({ uri: asset.uri }));
    } catch (error) {
      Alert.alert("无法保存头像", error instanceof Error ? error.message : "请稍后再试");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function removeAvatar(): Promise<void> {
    if (avatarSaving || !profile?.avatar) return;
    setAvatarSaving(true);
    try { onSaved(await removeProfileAvatar()); }
    catch (error) { Alert.alert("无法移除头像", error instanceof Error ? error.message : "请稍后再试"); }
    finally { setAvatarSaving(false); }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.profileModalBackdrop}>
        <View style={styles.profileModalPanel}>
          <View style={styles.profileModalHeader}>
            <Text style={styles.profileModalTitle}>编辑资料</Text>
            <Pressable hitSlop={10} onPress={onClose} disabled={saving || avatarSaving}>
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </Pressable>
          </View>
          <View style={styles.profileEditAvatar}>
            {profile?.avatar ? <Image source={{ uri: profile.avatar.url }} style={styles.profileEditAvatarImage} /> : <Text style={styles.profileEditAvatarText}>OIO</Text>}
            {avatarSaving ? <View style={styles.profileAvatarBusy}><ActivityIndicator color={theme.colors.surface} /></View> : null}
          </View>
          <View style={styles.profileAvatarActions}>
            <Pressable disabled={avatarSaving} onPress={chooseAvatar}><Text style={styles.profileAvatarActionText}>{profile?.avatar ? "更换头像" : "设置头像"}</Text></Pressable>
            {profile?.avatar ? <Pressable disabled={avatarSaving} onPress={() => void removeAvatar()}><Text style={styles.profileAvatarRemoveText}>移除头像</Text></Pressable> : null}
          </View>
          <Text style={styles.profileFieldLabel}>用户名</Text>
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            editable={!saving}
            maxLength={64}
            placeholder="输入用户名"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.profileNicknameInput}
          />
          <Text style={styles.profileFieldHint}>1–24 个字符；保存后会进行内容审核。用户名可以与其他人重复。</Text>
          <Pressable style={[styles.profileSaveButton, saving && styles.profileSaveButtonDisabled]} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={styles.profileSaveButtonText}>保存用户名</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BindingsModal({ visible, bindings, onClose, onBindEmail }: {
  visible: boolean;
  bindings: UserBindings | null;
  onClose: () => void;
  onBindEmail: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.profileModalBackdrop}>
        <View style={styles.profileModalPanel}>
          <View style={styles.profileModalHeader}>
            <Text style={styles.profileModalTitle}>绑定信息</Text>
            <Pressable hitSlop={10} onPress={onClose}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
          </View>
          <BindingRow label="手机号" item={bindings?.phone ?? null} />
          <BindingRow label="邮箱" item={bindings?.email ?? null} onBind={onBindEmail} />
          <Text style={styles.bindingPrivacy}>为保护隐私，这里只显示脱敏后的绑定信息。</Text>
        </View>
      </View>
    </Modal>
  );
}

function BindingRow({ label, item, onBind }: {
  label: string;
  item: UserBindings["phone"] | null;
  onBind?: () => void;
}) {
  let value = "正在加载";
  if (item?.bound) value = item.maskedValue ?? "已绑定";
  else if (item?.action === "unsupported") value = "暂不支持绑定";
  else if (item) value = "未绑定";
  return (
    <View style={styles.bindingRow}>
      <View style={styles.bindingRowBody}>
        <Text style={styles.bindingLabel}>{label}</Text>
        <Text style={styles.bindingValue}>{value}</Text>
      </View>
      {item?.action === "bind" && onBind ? (
        <Pressable style={styles.bindingButton} onPress={onBind}><Text style={styles.bindingButtonText}>绑定邮箱</Text></Pressable>
      ) : null}
    </View>
  );
}

function LanguageSettingsModal({
  visible,
  preference,
  onClose,
  onApplyAppLocale,
  onSave,
}: {
  visible: boolean;
  preference: UserPreference | null;
  onClose: () => void;
  onApplyAppLocale: (value: AppLocale) => void;
  onSave: (next: {
    appLocale: AppLocale;
    learningLanguage: LearningLanguage;
    promptDifficulty: PromptDifficulty;
    ttsVoiceCode: string;
    sttMultilingualRecognitionEnabled: boolean;
  }) => Promise<void>;
}) {
  const [appLocale, setAppLocale] = useState<AppLocale>("zh-CN");
  const [learningLanguage, setLearningLanguage] = useState<LearningLanguage>("en-US");
  const [promptDifficulty, setPromptDifficulty] = useState<PromptDifficulty>("native");
  const [ttsVoiceCode, setTtsVoiceCode] = useState("");
  const [ttsVoiceOptions, setTtsVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [multilingualRecognitionEnabled, setMultilingualRecognitionEnabled] = useState(false);
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const initializedVisibleRef = useRef(false);
  const currentLanguageVoiceOptions = ttsVoiceOptions.filter((option) => option.languageCode === learningLanguage);
  const canSave = !saving && currentLanguageVoiceOptions.some((option) => option.voiceCode === ttsVoiceCode);

  useEffect(() => {
    if (!visible) {
      initializedVisibleRef.current = false;
      return;
    }
    if (initializedVisibleRef.current) return;
    initializedVisibleRef.current = true;
    const nextLearningLanguage = preference?.learningLanguage ?? "en-US";
    setAppLocale(preference?.appLocale ?? "zh-CN");
    setLearningLanguage(nextLearningLanguage);
    setPromptDifficulty(preference?.promptDifficulty ?? "native");
    setMultilingualRecognitionEnabled(preference?.sttMultilingualRecognitionEnabled === true);
    setOpenSelect(null);
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
      await onSave({
        appLocale,
        learningLanguage,
        promptDifficulty,
        ttsVoiceCode,
        sttMultilingualRecognitionEnabled: multilingualRecognitionEnabled,
      });
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
          <ScrollView style={styles.languageForm} contentContainerStyle={styles.languageFormContent} showsVerticalScrollIndicator={false}>
            <SelectField
              id="appLocale"
              title={t("me.language.app_locale")}
              valueLabel={appLocaleLabel(appLocale)}
              open={openSelect === "appLocale"}
              options={APP_LOCALE_OPTIONS.map((option) => ({
                key: option.value,
                label: t(option.labelKey),
                active: appLocale === option.value,
                onPress: () => {
                  setAppLocale(option.value);
                  onApplyAppLocale(option.value);
                },
              }))}
              onToggle={() => setOpenSelect((current) => current === "appLocale" ? null : "appLocale")}
              onClose={() => setOpenSelect(null)}
            />
            <SelectField
              id="learningLanguage"
              title={t("me.language.learning")}
              valueLabel={learningLanguageLabel(learningLanguage)}
              open={openSelect === "learningLanguage"}
              options={LEARNING_LANGUAGE_OPTIONS.map((option) => ({
                key: option.value,
                label: t(option.labelKey),
                active: learningLanguage === option.value,
                onPress: () => {
                  setLearningLanguage(option.value);
                  setTtsVoiceCode(resolveTtsVoiceCodeForLanguage(ttsVoiceOptions, option.value, null));
                },
              }))}
              onToggle={() => setOpenSelect((current) => current === "learningLanguage" ? null : "learningLanguage")}
              onClose={() => setOpenSelect(null)}
            />
            <SelectField
              id="promptDifficulty"
              title={t("me.language.difficulty")}
              valueLabel={promptDifficultyLabel(promptDifficulty)}
              open={openSelect === "promptDifficulty"}
              options={PROMPT_DIFFICULTY_OPTIONS.map((option) => ({
                key: option.value,
                label: t(option.labelKey),
                active: promptDifficulty === option.value,
                onPress: () => setPromptDifficulty(option.value),
              }))}
              onToggle={() => setOpenSelect((current) => current === "promptDifficulty" ? null : "promptDifficulty")}
              onClose={() => setOpenSelect(null)}
            />
            <SelectField
              id="ttsVoice"
              title={t("me.language.tts_voice")}
              valueLabel={voiceLoading ? "" : currentLanguageVoiceOptions.find((option) => option.voiceCode === ttsVoiceCode)?.label ?? ""}
              open={openSelect === "ttsVoice"}
              disabled={voiceLoading || voiceError || currentLanguageVoiceOptions.length === 0}
              options={currentLanguageVoiceOptions.map((option) => ({
                key: option.voiceCode,
                label: option.label,
                detail: learningLanguageLabel(option.languageCode as LearningLanguage),
                active: ttsVoiceCode === option.voiceCode,
                onPress: () => setTtsVoiceCode(option.voiceCode),
              }))}
              onToggle={() => setOpenSelect((current) => current === "ttsVoice" ? null : "ttsVoice")}
              onClose={() => setOpenSelect(null)}
            />
            {voiceLoading ? <ActivityIndicator style={styles.languageInlineStatus} size="small" color="#1F6FEB" /> : null}
            {voiceError ? <Text style={styles.languageHint}>{t("tts.error.failed")}</Text> : null}
            <View style={styles.languageAdvancedBlock}>
              <Text style={styles.languageFieldTitle}>{t("me.language.stt_advanced")}</Text>
              <Pressable
                style={styles.languageToggleRow}
                onPress={() => setMultilingualRecognitionEnabled((value) => !value)}
              >
                <View style={[styles.languageToggleBox, multilingualRecognitionEnabled && styles.languageToggleBoxActive]}>
                  {multilingualRecognitionEnabled ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                </View>
                <View style={styles.languageToggleTextWrap}>
                  <Text style={styles.languageToggleTitle}>{t("me.language.stt_multilingual")}</Text>
                </View>
              </Pressable>
            </View>
          </ScrollView>
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

function SelectField({
  title,
  hint,
  valueLabel,
  open,
  disabled,
  options,
  onToggle,
  onClose,
}: {
  id: string;
  title: string;
  hint?: string;
  valueLabel: string;
  open: boolean;
  disabled?: boolean;
  options: Array<{
    key: string;
    label: string;
    detail?: string;
    active: boolean;
    onPress: () => void;
  }>;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.selectField}>
      <Text style={styles.languageFieldTitle}>{title}</Text>
      {hint ? <Text style={styles.languageHint}>{hint}</Text> : null}
      <Pressable
        style={[styles.selectButton, disabled && styles.selectButtonDisabled]}
        onPress={disabled ? undefined : onToggle}
        disabled={disabled}
      >
        <Text style={[styles.selectButtonText, !valueLabel && styles.selectButtonTextMuted]} numberOfLines={1}>
          {valueLabel || "-"}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={disabled ? "#B4BBC7" : "#343A45"} />
      </Pressable>
      {open && !disabled ? (
        <View style={styles.selectMenu}>
          {options.map((option) => (
            <Pressable
              key={option.key}
              style={[styles.selectOption, option.active && styles.selectOptionActive]}
              onPress={() => {
                option.onPress();
                onClose();
              }}
            >
              <View style={styles.selectOptionTextWrap}>
                {option.detail ? <Text style={[styles.selectOptionDetail, option.active && styles.selectOptionTextActive]}>{option.detail}</Text> : null}
                <Text style={[styles.selectOptionText, option.active && styles.selectOptionTextActive]} numberOfLines={1}>
                  {option.label}
                </Text>
              </View>
              {option.active ? <Ionicons name="checkmark" size={18} color="#FFFFFF" /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
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

const LEARNING_LANGUAGE_LABELS: Record<LearningLanguage, Parameters<typeof t>[0]> = {
  "en-US": "learning.en_us",
  "ja-JP": "learning.ja_jp",
};

const LEARNING_LANGUAGE_OPTIONS = TARGET_LANGUAGE_CODES.map((value) => ({
  value,
  labelKey: LEARNING_LANGUAGE_LABELS[value],
}));

const PROMPT_DIFFICULTY_OPTIONS: Array<{ value: PromptDifficulty; labelKey: Parameters<typeof t>[0] }> = [
  { value: "simple", labelKey: "prompt_difficulty.simple" },
  { value: "native", labelKey: "prompt_difficulty.native" },
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
  sheetHeader: {
    minHeight: 54,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  sheetClose: {
    width: 48,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    flex: 1,
    color: theme.colors.text,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
  },
  scroller: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 92,
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
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    color: "#343041",
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  profileAvatarImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
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
    color: theme.colors.accentStrong,
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
    backgroundColor: theme.colors.accentStrong,
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
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.accentSoft,
  },
  proTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
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
    borderColor: theme.colors.border,
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
    maxHeight: "88%",
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
  languageForm: {
    flexShrink: 1,
    marginTop: 2,
  },
  languageFormContent: {
    paddingBottom: 2,
  },
  selectField: {
    marginTop: 14,
  },
  selectButton: {
    marginTop: 8,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectButtonDisabled: {
    backgroundColor: "#F5F6F8",
  },
  selectButtonText: {
    flex: 1,
    color: "#343A45",
    fontSize: 13,
    fontWeight: "700",
  },
  selectButtonTextMuted: {
    color: "#A3A9B4",
  },
  selectMenu: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  selectOption: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF0F4",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectOptionActive: {
    backgroundColor: "#111111",
  },
  selectOptionTextWrap: {
    flex: 1,
  },
  selectOptionText: {
    color: "#343A45",
    fontSize: 13,
    fontWeight: "700",
  },
  selectOptionDetail: {
    marginBottom: 2,
    color: "#7E8491",
    fontSize: 11,
    fontWeight: "600",
  },
  selectOptionTextActive: {
    color: "#FFFFFF",
  },
  languageInlineStatus: {
    marginTop: 10,
    alignSelf: "flex-start",
  },
  languageAdvancedBlock: {
    marginTop: 14,
  },
  languageToggleRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FAFBFC",
  },
  languageToggleBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#B8C0CC",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  languageToggleBoxActive: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  languageToggleTextWrap: {
    flex: 1,
  },
  languageToggleTitle: {
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
    backgroundColor: theme.colors.accentSoft,
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
  profileModalBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
    backgroundColor: theme.colors.scrim,
  },
  profileModalPanel: {
    padding: 18,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
  },
  profileModalHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
  },
  profileModalTitle: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "600",
  },
  profileEditAvatar: {
    marginTop: 18,
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentSoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  profileEditAvatarImage: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  profileEditAvatarText: {
    color: theme.colors.accentStrong,
    fontSize: 16,
    fontWeight: "600",
  },
  profileAvatarBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(30,35,38,0.55)",
  },
  profileAvatarActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
  },
  profileAvatarActionText: { color: theme.colors.accentStrong, fontSize: 13, fontWeight: "600" },
  profileAvatarRemoveText: { color: theme.colors.danger, fontSize: 13 },
  profileFieldLabel: {
    marginTop: 20,
    marginBottom: 7,
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  profileNicknameInput: {
    height: 48,
    paddingHorizontal: 13,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.canvas,
    color: theme.colors.text,
    fontSize: 16,
  },
  profileFieldHint: {
    marginTop: 7,
    color: theme.colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  profileSaveButton: {
    marginTop: 18,
    height: 46,
    borderRadius: theme.radius.control,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentStrong,
  },
  profileSaveButtonDisabled: { opacity: 0.6 },
  profileSaveButtonText: { color: theme.colors.surface, fontSize: 15, fontWeight: "600" },
  bindingRow: {
    minHeight: 66,
    marginTop: 10,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.radius.control,
    backgroundColor: theme.colors.canvas,
  },
  bindingRowBody: { flex: 1 },
  bindingLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  bindingValue: { marginTop: 4, color: theme.colors.textSecondary, fontSize: 12 },
  bindingButton: { minHeight: 36, paddingHorizontal: 11, borderRadius: theme.radius.pill, justifyContent: "center", backgroundColor: theme.colors.accentSoft },
  bindingButtonText: { color: theme.colors.accentStrong, fontSize: 12, fontWeight: "600" },
  bindingPrivacy: { marginTop: 12, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
});
