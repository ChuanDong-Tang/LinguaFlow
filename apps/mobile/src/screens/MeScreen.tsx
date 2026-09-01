import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession, type AuthSession } from "../services/auth/authStorage";
import {
  getUserPreference,
  getUserBindings,
  getUserProfile,
  getUsageV2,
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
  type UsageV2,
} from "../services/api/meApi";
import { getCachedEntitlementForUser, isSameEntitlement } from "../services/entitlement/entitlementCache";
import { refreshEntitlementAndSessionSafe } from "../services/entitlement/entitlementSync";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { t, tf } from "../i18n";
import { DebugPromptModal } from "./shared/DebugPromptModal";
import { listTtsVoices, type TtsVoiceOption } from "../services/api/ttsApi";
import { stopTtsAudio } from "../services/tts/ttsPlayback";
import { getLogs, type AppLog } from "../services/logger";
import { theme } from "../theme";
import { prepareAndUploadAvatar } from "../services/profile/avatarUpload";
import { TARGET_LANGUAGE_CODES } from "@lf/core/language/targetLanguages";
import { ProScreen } from "./ProScreen";
import { stabilizeProfileAvatar } from "../services/image/signedImageCache";

type MeScreenProps = {
  isActive: boolean;
  onOpenAbout: () => void;
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

export function MeScreen({ isActive, onOpenAbout, onApplyAppLocale, sessionRevision, onBindEmail, onLogout, onDeleteAccount, onClose }: MeScreenProps) {
  const { isMounted } = useMountedGuard();
  const appLocaleSyncSeqRef = useRef(0);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [entitlement, setEntitlement] = useState<CurrentEntitlement | null>(null);
  const [usageV2, setUsageV2] = useState<UsageV2 | null>(null);
  const [preference, setPreference] = useState<UserPreference | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const [bindings, setBindings] = useState<UserBindings | null>(null);
  const [profileVisible, setProfileVisible] = useState(false);
  const [bindingsVisible, setBindingsVisible] = useState(false);
  const pendingBindEmailRef = useRef(false);
  const bindEmailFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [languageSettingsVisible, setLanguageSettingsVisible] = useState(false);
  const [devDebugVisible, setDevDebugVisible] = useState(false);
  const [aiDebugVisible, setAiDebugVisible] = useState(false);
  const [isLoadingEntitlement, setIsLoadingEntitlement] = useState(true);
  const [updatesDebugVisible, setUpdatesDebugVisible] = useState(false);
  const [updatesAction, setUpdatesAction] = useState<string | null>(null);
  const [updatesResult, setUpdatesResult] = useState(() => t("me.debug.not_run"));

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => () => {
    if (bindEmailFallbackTimerRef.current) clearTimeout(bindEmailFallbackTimerRef.current);
  }, []);

  function finishBindEmailHandoff(): void {
    if (!pendingBindEmailRef.current) return;
    pendingBindEmailRef.current = false;
    if (bindEmailFallbackTimerRef.current) {
      clearTimeout(bindEmailFallbackTimerRef.current);
      bindEmailFallbackTimerRef.current = null;
    }
    void onBindEmail();
  }

  function requestBindEmail(): void {
    pendingBindEmailRef.current = true;
    setBindingsVisible(false);
    // iOS uses Modal.onDismiss. Android does not consistently emit it, so wait
    // for the fade transition before handing off to the next modal.
    if (Platform.OS !== "ios") {
      bindEmailFallbackTimerRef.current = setTimeout(finishBindEmailHandoff, 250);
    }
  }

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    async function loadProfile() {
      if (isMounted()) setIsLoadingEntitlement(true);
      const localSession = await getSession();
      const [cached, localPreference, remoteProfile, remoteBindings, remoteUsage] = await Promise.all([
        localSession?.user.id ? getCachedEntitlementForUser(localSession.user.id) : Promise.resolve(null),
        localSession ? getUserPreference().catch(() => null) : Promise.resolve(null),
        localSession ? getUserProfile().catch(() => null) : Promise.resolve(null),
        localSession ? getUserBindings().catch(() => null) : Promise.resolve(null),
        localSession ? getUsageV2().catch(() => null) : Promise.resolve(null),
      ]);
      const stableProfile = remoteProfile
        ? await stabilizeProfileAvatar(profileRef.current, remoteProfile)
        : null;
      if (cancelled || !isMounted()) return;
      setSession(localSession);
      if (cached) setEntitlement(cached.data);
      if (localPreference) setPreference(localPreference);
      if (stableProfile) setProfile(stableProfile);
      if (remoteBindings) setBindings(remoteBindings);
      if (remoteUsage) setUsageV2(remoteUsage);
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
    if (usageV2) {
      const remainingRatio = Math.max(0, Math.min(1, usageV2.token.remainingPercent / 100));
      const usedRatio = usageV2.token.quota > 0
        ? Math.max(0, Math.min(1, usageV2.token.used / usageV2.token.quota))
        : 0;
      const usedPercent = Math.round(usedRatio * 1000) / 10;
      return {
        dailyTotalLimit: usageV2.token.quota,
        remainingChars: usageV2.token.remaining,
        remainingPercent: usageV2.token.remainingPercent,
        ratio: remainingRatio,
        usedPercent,
        usedRatio,
      };
    }
    const dailyTotalLimit = entitlement?.dailyTotalLimit ?? (session?.sessionFlags?.isPro ? 10000 : 10000);
    const remainingChars = entitlement?.remainingChars ?? null;
    const ratio = remainingChars === null || dailyTotalLimit <= 0 ? 0 : remainingChars / dailyTotalLimit;

    // 进度条只接受 0-1，避免异常数据把布局撑出容器。
    const normalizedRatio = Math.max(0, Math.min(1, ratio));
    return {
      dailyTotalLimit,
      remainingChars,
      remainingPercent: Math.round(normalizedRatio * 100),
      ratio: normalizedRatio,
      usedPercent: Math.round((1 - normalizedRatio) * 100),
      usedRatio: 1 - normalizedRatio,
    };
  }, [entitlement, session?.sessionFlags?.isPro, usageV2]);
  const imageQuota = useMemo(() => {
    if (!usageV2) return null;
    const capacity = Number(usageV2.images.quotaBytes ?? usageV2.images.capacityBytes);
    const used = Number(usageV2.images.uploadedBytes ?? usageV2.images.usedBytes);
    const ratio = Number.isFinite(capacity) && capacity > 0 && Number.isFinite(used)
      ? Math.max(0, Math.min(1, used / capacity))
      : 0;
    return { ratio };
  }, [usageV2]);

  // Never fall back to raw auth email/phone while the privacy-safe profile is loading.
  const userName = profile?.nickname || "OIO";
  const isAdmin = session?.user.role === "admin";
  const isMember = entitlement ? (entitlement.isMember ?? entitlement.isPro) : session?.sessionFlags?.isPro === true;
  const planLabel = resolvePlanLabel(entitlement, session);
  const quotaTitle = usageV2 ? t("me.quota.v2_title") : isMember ? t("me.quota.pro_title") : t("me.quota.free_title");
  const quotaLabel = isMember ? t("me.quota.pro_label") : t("me.quota.free_label");
  const quotaResetText = usageV2
    ? tf("me.quota.v2_refresh", { time: formatDateTime(usageV2.token.periodEnd) })
    : isMember
    ? t("me.quota.reset_daily")
    : entitlement?.validUntil
      ? tf("me.quota.valid_until", { time: formatDateTime(entitlement.validUntil) })
      : t("me.quota.free_valid");
  const bindingSummary = bindings?.email.bound
    ? bindings.email.maskedValue ?? t("me.bindings.bound")
    : bindings?.phone.maskedValue ?? t("me.bindings.view");

  function handleEntitlementChanged(next: CurrentEntitlement): void {
    const changed = !isSameEntitlement(entitlement, next);
    if (changed) setEntitlement(next);
    setSession((current) => {
      if (!current) return current;
      const isPro = next.isMember ?? next.isPro;
      if (current.sessionFlags?.isPro === isPro) return current;
      return {
        ...current,
        sessionFlags: { ...(current.sessionFlags ?? {}), isPro },
      };
    });
    if (changed) {
      void getUsageV2()
        .then((usage) => { if (isMounted()) setUsageV2(usage); })
        .catch(() => undefined);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {onClose ? (
        <View style={styles.sheetHeader}>
          <View style={styles.sheetClose} />
          <Text style={styles.sheetTitle}>{t("me.title")}</Text>
          <Pressable accessibilityLabel={t("me.a11y.close")} style={styles.sheetClose} onPress={onClose}>
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </Pressable>
        </View>
      ) : null}
      <ScrollView style={styles.scroller} contentContainerStyle={styles.content} showsVerticalScrollIndicator alwaysBounceVertical={false}>
        <Pressable
          style={styles.profileRow}
          onPress={() => setProfileVisible(true)}
          onLongPress={() => { if (isAdmin) setDevDebugVisible(true); }}
        >
          <View style={styles.profileAvatar}>
            {profile?.avatar ? <Image source={{ uri: profile.avatar.thumbnailUrl }} style={styles.profileAvatarImage} /> : <Ionicons name="person-outline" size={24} color={theme.colors.textSecondary} />}
          </View>
          <View style={styles.profileBody}>
            <Text style={styles.profileName}>{userName}</Text>
            <Text style={styles.profilePlan}>{planLabel}</Text>
          </View>
        </Pressable>

        <View style={styles.quotaCard}>
          <Text style={styles.cardTitle}>{quotaTitle}</Text>
          {usageV2 ? (
            <>
              <UsageMeter
                label={t("me.quota.v2_ai")}
                value={tf("me.quota.v2_used_percent", { percent: quota.usedPercent })}
                ratio={quota.usedRatio}
                loading={isLoadingEntitlement}
              />
              <UsageMeter
                label={t("me.quota.v2_images")}
                value={tf("me.quota.v2_used_amount", {
                  used: formatStorageBytes(usageV2.images.uploadedBytes ?? usageV2.images.usedBytes),
                  total: formatStorageBytes(usageV2.images.quotaBytes ?? usageV2.images.capacityBytes),
                })}
                ratio={imageQuota?.ratio ?? 0}
              />
              <Text style={styles.usageRefreshText}>{quotaResetText}</Text>
            </>
          ) : (
            <>
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
                <Text style={styles.progressText}>{quota.remainingPercent}%</Text>
              </View>
              <Text style={styles.resetText}>{quotaResetText}</Text>
            </>
          )}
        </View>

        <View style={styles.proCard}>
          <Text style={styles.proTitle}>{t("me.pro.title")}</Text>
          {isActive ? (
            isLoadingEntitlement
              ? <ActivityIndicator size="small" color={theme.colors.accentStrong} style={styles.membershipLoading} />
              : <ProScreen compact initialEntitlement={entitlement} onEntitlementChanged={handleEntitlementChanged} />
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>{t("me.section.more")}</Text>
        <View style={styles.settingsCard}>
          <SettingsRow
            icon="link-outline"
            label={t("me.bindings.title")}
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
          <SettingsRow icon="information-circle-outline" label={t("me.about")} onPress={onOpenAbout} />
          <SettingsRow icon="log-out-outline" label={t("me.logout")} onPress={onLogout} />
          <SettingsRow icon="person-remove-outline" label={t("me.delete_account")} onPress={onDeleteAccount} tone="danger" isLast />
        </View>
      </ScrollView>
      <ProfileEditModal
        visible={profileVisible}
        profile={profile}
        onClose={() => setProfileVisible(false)}
        onSaved={(nextProfile) => {
          void stabilizeProfileAvatar(profileRef.current, nextProfile).then((stableProfile) => {
            if (isMounted()) setProfile(stableProfile);
          });
        }}
      />
      <BindingsModal
        visible={bindingsVisible}
        bindings={bindings}
        onClose={() => {
          pendingBindEmailRef.current = false;
          setBindingsVisible(false);
        }}
        onDismiss={finishBindEmailHandoff}
        onBindEmail={requestBindEmail}
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
      Alert.alert(t("me.profile.nickname_save_failed"), error instanceof Error ? error.message : t("me.profile.try_again"));
    } finally {
      setSaving(false);
    }
  }

  function chooseAvatar(): void {
    if (avatarSaving) return;
    Alert.alert(t("me.profile.change_avatar"), undefined, [
      { text: t("me.profile.take_photo"), onPress: () => void pickAvatar("camera") },
      { text: t("me.profile.choose_photo"), onPress: () => void pickAvatar("library") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  async function pickAvatar(source: "camera" | "library"): Promise<void> {
    if (source === "camera" || Platform.OS !== "android") {
      const permission = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("me.profile.photo_permission"), source === "camera" ? t("me.profile.camera_permission_message") : t("me.profile.library_permission_message"));
        return;
      }
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
      Alert.alert(t("me.profile.avatar_save_failed"), error instanceof Error ? error.message : t("me.profile.try_again"));
    } finally {
      setAvatarSaving(false);
    }
  }

  async function removeAvatar(): Promise<void> {
    if (avatarSaving || !profile?.avatar) return;
    setAvatarSaving(true);
    try { onSaved(await removeProfileAvatar()); }
    catch (error) { Alert.alert(t("me.profile.avatar_remove_failed"), error instanceof Error ? error.message : t("me.profile.try_again")); }
    finally { setAvatarSaving(false); }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.profileModalBackdrop}>
        <View style={styles.profileModalPanel}>
          <View style={styles.profileModalHeader}>
            <Text style={styles.profileModalTitle}>{t("me.profile.edit")}</Text>
            <Pressable hitSlop={10} onPress={onClose} disabled={saving || avatarSaving}>
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </Pressable>
          </View>
          <View style={styles.profileEditAvatar}>
            {profile?.avatar ? <Image source={{ uri: profile.avatar.url }} style={styles.profileEditAvatarImage} /> : <Ionicons name="person-outline" size={31} color={theme.colors.textSecondary} />}
            {avatarSaving ? <View style={styles.profileAvatarBusy}><ActivityIndicator color={theme.colors.surface} /></View> : null}
          </View>
          <View style={styles.profileAvatarActions}>
            <Pressable disabled={avatarSaving} onPress={chooseAvatar}><Text style={styles.profileAvatarActionText}>{profile?.avatar ? t("me.profile.change_avatar") : t("me.profile.set_avatar")}</Text></Pressable>
            {profile?.avatar ? <Pressable disabled={avatarSaving} onPress={() => void removeAvatar()}><Text style={styles.profileAvatarRemoveText}>{t("me.profile.remove_avatar")}</Text></Pressable> : null}
          </View>
          <Text style={styles.profileFieldLabel}>{t("me.profile.username")}</Text>
          <TextInput
            value={nickname}
            onChangeText={setNickname}
            editable={!saving}
            maxLength={64}
            placeholder={t("me.profile.username_placeholder")}
            placeholderTextColor={theme.colors.textMuted}
            style={styles.profileNicknameInput}
          />
          <Text style={styles.profileFieldHint}>{t("me.profile.username_hint")}</Text>
          <Pressable style={[styles.profileSaveButton, saving && styles.profileSaveButtonDisabled]} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={styles.profileSaveButtonText}>{t("me.profile.save_username")}</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function BindingsModal({ visible, bindings, onClose, onDismiss, onBindEmail }: {
  visible: boolean;
  bindings: UserBindings | null;
  onClose: () => void;
  onDismiss: () => void;
  onBindEmail: () => void;
}) {
  const isPhoneRegistration = bindings?.registrationMethod === "phone";
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <View style={styles.profileModalBackdrop}>
        <View style={styles.profileModalPanel}>
          <View style={styles.profileModalHeader}>
            <Text style={styles.profileModalTitle}>{t("me.bindings.title")}</Text>
            <Pressable hitSlop={10} onPress={onClose}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
          </View>
          {!bindings ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.bindingsLoading} /> : <>
            {isPhoneRegistration ? <BindingRow label={t("me.bindings.phone")} item={bindings.phone} /> : null}
            <BindingRow label={t("me.bindings.email")} item={bindings.email} onBind={onBindEmail} />
          </>}
          <Text style={styles.bindingPrivacy}>{t("me.bindings.privacy")}</Text>
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
  let value = t("me.bindings.loading");
  if (item?.bound) value = item.maskedValue ?? t("me.bindings.bound");
  else if (item?.action === "unsupported") value = t("me.bindings.unsupported");
  else if (item) value = t("me.bindings.unbound");
  const canBind = item?.action === "bind" && Boolean(onBind);
  return (
    <Pressable disabled={!canBind} accessibilityRole={canBind ? "button" : undefined} style={({ pressed }) => [styles.bindingRow, pressed && canBind && styles.bindingRowPressed]} onPress={canBind ? onBind : undefined}>
      <View style={styles.bindingRowBody}>
        <Text style={styles.bindingLabel}>{label}</Text>
        <Text style={styles.bindingValue}>{value}</Text>
      </View>
      {canBind ? (
        <View style={styles.bindingButton}>
          <Text style={styles.bindingButtonText}>{t("me.bind_email")}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.accentStrong} />
        </View>
      ) : null}
    </Pressable>
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
      const voiceChanged = ttsVoiceCode !== preference?.ttsVoiceCode;
      await onSave({
        appLocale,
        learningLanguage,
        promptDifficulty,
        ttsVoiceCode,
        sttMultilingualRecognitionEnabled: multilingualRecognitionEnabled,
      });
      if (voiceChanged) stopTtsAudio({ resetControls: true });
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
          <ScrollView style={styles.languageForm} contentContainerStyle={styles.languageFormContent} showsVerticalScrollIndicator alwaysBounceVertical={false}>
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
            {voiceLoading ? <ActivityIndicator style={styles.languageInlineStatus} size="small" color="#171717" /> : null}
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
  const buttonRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const { height: windowHeight } = useWindowDimensions();
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const estimatedMenuHeight = options.reduce((height, option) => height + (option.detail ? 58 : 42), 2);
  const menuTop = anchor
    ? anchor.y + anchor.height + 6 + estimatedMenuHeight <= windowHeight - 8
      ? anchor.y + anchor.height + 6
      : Math.max(8, anchor.y - estimatedMenuHeight - 6)
    : 0;

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    requestAnimationFrame(() => {
      buttonRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
    });
  }, [open]);

  const menuOptions = options.map((option) => (
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
  ));

  return (
    <View style={styles.selectField}>
      <Text style={styles.languageFieldTitle}>{title}</Text>
      {hint ? <Text style={styles.languageHint}>{hint}</Text> : null}
      <Pressable
        ref={buttonRef}
        style={[styles.selectButton, disabled && styles.selectButtonDisabled]}
        onPress={disabled ? undefined : () => {
          if (!open) buttonRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
          onToggle();
        }}
        disabled={disabled}
      >
        <Text style={[styles.selectButtonText, !valueLabel && styles.selectButtonTextMuted]} numberOfLines={1}>
          {valueLabel || "-"}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={disabled ? "#B4BBC7" : "#343A45"} />
      </Pressable>
      <Modal visible={open && !disabled && Boolean(anchor)} transparent animationType="none" onRequestClose={onClose}>
        <View style={styles.selectMenuOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
          {anchor ? <View style={[styles.selectMenu, { left: anchor.x, top: menuTop, width: anchor.width, maxHeight: windowHeight - 16 }]}>
            <ScrollView nestedScrollEnabled bounces={false} showsVerticalScrollIndicator={options.length > 6}>
              {menuOptions}
            </ScrollView>
          </View> : null}
        </View>
      </Modal>
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
            <Text style={styles.languageTitle}>{t("me.debug.title")}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#111111" />
            </Pressable>
          </View>
          <View style={styles.settingsCard}>
            <SettingsRow icon="code-slash-outline" label={t("me.debug.ai")} onPress={onOpenAiDebug} />
            <SettingsRow icon="cloud-download-outline" label={t("me.debug.updates")} onPress={onOpenUpdatesDebug} isLast />
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
            <Text style={styles.updatesDebugTitle}>{t("me.debug.updates")}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color="#111111" />
            </Pressable>
          </View>
          <ScrollView style={styles.updatesDebugBody} contentContainerStyle={styles.updatesDebugContent} alwaysBounceVertical={false}>
            {statusRows.map(([label, value]) => (
              <View key={label} style={styles.updatesDebugRow}>
                <Text style={styles.updatesDebugLabel}>{label}</Text>
                <Text selectable style={styles.updatesDebugValue}>{value}</Text>
              </View>
            ))}
            <View style={styles.updatesDebugActions}>
              <DebugButton label={t("me.debug.check_update")} disabled={!!runningAction} onPress={() => onRun("check", Updates.checkForUpdateAsync)} />
              <DebugButton label={t("me.debug.download_update")} disabled={!!runningAction} onPress={() => onRun("fetch", Updates.fetchUpdateAsync)} />
              <DebugButton label={t("me.debug.reload")} disabled={!!runningAction} onPress={() => onRun("reload", Updates.reloadAsync)} />
              <DebugButton label={t("me.debug.read_logs")} disabled={!!runningAction} onPress={() => onRun("logs", readCombinedDiagnostics)} />
            </View>
            <Text style={styles.updatesDebugHint}>{t("me.debug.update_hint")}</Text>
            <Text style={styles.updatesDebugResultTitle}>{t("me.debug.result")}</Text>
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

function UsageMeter({ label, value, ratio, loading = false }: {
  label: string;
  value: string;
  ratio: number;
  loading?: boolean;
}) {
  return (
    <View style={styles.usageMeter}>
      <View style={styles.usageMeterHeader}>
        <Text style={styles.usageMeterLabel}>{label}</Text>
        <View style={styles.usageMeterValueRow}>
          {loading ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
          <Text style={styles.usageMeterValue}>{value}</Text>
        </View>
      </View>
      <View style={styles.usageProgressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }]} />
      </View>
    </View>
  );
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

function formatStorageBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes % (1024 ** 3) === 0 ? 0 : 1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes % (1024 ** 2) === 0 ? 0 : 1)} MB`;
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
    backgroundColor: "#FFFFFF",
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
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
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
    color: "#707070",
    fontSize: 13,
  },

  quotaCard: {
    marginTop: 18,
    paddingVertical: 16,
    borderRadius: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E5E5",
    backgroundColor: "#FFFFFF",
  },
  cardTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  usageMeter: {
    marginTop: 14,
  },
  usageMeterHeader: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  usageMeterLabel: {
    color: "#333333",
    fontSize: 13,
  },
  usageMeterValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  usageMeterValue: {
    color: "#555555",
    fontSize: 12,
    fontWeight: "500",
  },
  usageProgressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "#E8E8E8",
    overflow: "hidden",
  },
  usageRefreshText: {
    marginTop: 6,
    color: "#888888",
    fontSize: 11,
  },
  quotaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "baseline",
  },
  quotaLabel: {
    color: "#666666",
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
    backgroundColor: "#E8E8E8",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.colors.accentStrong,
  },
  progressText: {
    minWidth: 92,
    color: "#666666",
    fontSize: 11,
    textAlign: "right",
  },
  resetText: {
    marginTop: 8,
    color: "#666666",
    fontSize: 12,
  },

  proCard: {
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5E5",
    backgroundColor: "#FFFFFF",
  },
  membershipLoading: {
    marginVertical: 28,
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
    color: "#666666",
    fontSize: 13,
  },
  proButton: {
    marginTop: 10,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 7,
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
    color: "#666666",
    fontSize: 13,
  },
  settingsCard: {
    borderRadius: 0,
    borderWidth: 0,
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
    borderBottomColor: "#E8E8E8",
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
    color: "#808080",
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
    position: "relative",
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
    position: "absolute",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    zIndex: 21,
    elevation: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  selectMenuOverlay: {
    flex: 1,
  },
  selectOption: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
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
    color: "#707070",
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
    color: "#707070",
    fontSize: 12,
    fontWeight: "600",
  },
  updatesDebugResult: {
    marginTop: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#F5F5F5",
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
  bindingRowPressed: { opacity: 0.55 },
  bindingRowBody: { flex: 1 },
  bindingLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
  bindingValue: { marginTop: 4, color: theme.colors.textSecondary, fontSize: 12 },
  bindingButton: { minHeight: 36, paddingLeft: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 },
  bindingButtonText: { color: theme.colors.accentStrong, fontSize: 13, fontWeight: "600" },
  bindingsLoading: { marginVertical: 24 },
  bindingPrivacy: { marginTop: 12, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
});
