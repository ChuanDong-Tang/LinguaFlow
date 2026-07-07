import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as AuthSession from "expo-auth-session";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { LoginScreen } from "./screens/LoginScreen";
import { getLanguage, getSavedLanguage, initI18n, setLanguage, t, tf } from "./i18n";
import { clearSession, getSession, markForceAuthingLogin } from "./services/auth/authStorage";
import { clearAccountScopedStorage } from "./services/auth/accountScopedStorage";
import { reconcileLocalInstallState } from "./services/storage/installState";
import { confirmDeleteAccount, logout, prepareDeleteAccount } from "./services/api/authApi";
import {
  getUserPreference,
  updateUserPreference,
  type AppLocale,
  type LearningLanguage,
  type PromptDifficulty,
  type PromptStyle,
  type UserPreference,
} from "./services/api/meApi";
import { MainScreen } from "./screens/MainScreen";
import { MeScreen } from "./screens/MeScreen";
import { ProScreen } from "./screens/ProScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { PracticeSessionScreen } from "./screens/PracticeSessionScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { FloatingNoticeProvider } from "./screens/shared/FloatingNotice";
import { TabBar } from "./screens/shared/TabBar";
import { LearningFlowHelpModal, LearningPreferenceModal, UiLocaleSetupModal } from "./screens/shared/OnboardingModals";
import {
  completeGuide,
  GUIDE_FIRST_LEARNING_SETUP,
  GUIDE_INITIAL_UI_LOCALE,
  GUIDE_LEARNING_FLOW_HELP,
  isGuideCompleted,
  loadLocalGuideState,
  markLocalGuideCompleted,
  mergeGuideState,
  saveLocalGuideState,
  type GuideState,
} from "./services/preferences/guideState";
import {
  getAuthingClientId,
  getAuthingDiscovery,
  getAuthingRedirectUri,
  isAuthingConfigured,
} from "./services/auth/authingAuth";
import { onSessionInvalid } from "./services/auth/authSessionEvents";
import type { ChatMessage } from "./domain/chat/types";
import type { PracticeCard } from "./domain/practice/practiceService";
import {
  DEFAULT_CHAT_CONTACT,
  type ChatContact,
} from "./domain/chat/contacts";
import { fetchChatContacts, loadCachedChatContacts } from "./services/api/chatContactsApi";

type Screen =
  | "booting"
  | "login"
  | "main"
  | "chat"
  | "practice"
  | "practiceSession"
  | "me"
  | "pro"
  | "about";

const PRELOAD_IMAGES = [require("../assets/app/logo.png")];

export default function App() {
  const [screen, setScreen] = useState<Screen>("booting");
  const [selectedTab, setSelectedTab] = useState<"main" | "practice" | "me">("main");
  const [practiceSession, setPracticeSession] = useState<{
    cards: PracticeCard[];
    messages: ChatMessage[];
  } | null>(null);
  const [activeContact, setActiveContact] = useState<ChatContact>(DEFAULT_CHAT_CONTACT);
  const [chatContacts, setChatContacts] = useState<ChatContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(false);
  const [, bumpLanguageRevision] = useState(0);
  const [uiLocaleSetupVisible, setUiLocaleSetupVisible] = useState(false);
  const [uiLocaleDraft, setUiLocaleDraft] = useState<AppLocale>("zh-CN");
  const [learningPreferenceVisible, setLearningPreferenceVisible] = useState(false);
  const [learningPreferenceSaving, setLearningPreferenceSaving] = useState(false);
  const [learningLanguageDraft, setLearningLanguageDraft] = useState<LearningLanguage>("en-US");
  const [promptDifficultyDraft, setPromptDifficultyDraft] = useState<PromptDifficulty>("natural");
  const [promptStyleDraft, setPromptStyleDraft] = useState<PromptStyle>("native_casual");
  const [guideState, setGuideState] = useState<GuideState>({});
  const [guideStateUserId, setGuideStateUserId] = useState<string | null>(null);
  const [onboardingHelpVisible, setOnboardingHelpVisible] = useState(false);
  const [manualHelpVisible, setManualHelpVisible] = useState(false);
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteAccountAuthingToken, setDeleteAccountAuthingToken] = useState("");
  const [deleteAccountMethod, setDeleteAccountMethod] = useState<"PHONE_PASSCODE" | "EMAIL_PASSCODE" | null>(null);
  const [deleteAccountTarget, setDeleteAccountTarget] = useState("");
  const [deleteAccountCode, setDeleteAccountCode] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountUserId, setDeleteAccountUserId] = useState("");
  const deleteAccountRunIdRef = useRef(0);
  const authingConfigured = isAuthingConfigured();
  const authingDiscovery = authingConfigured ? getAuthingDiscovery() : null;
  const authingClientId = authingConfigured ? getAuthingClientId() : "authing-disabled";
  const authingRedirectUri = getAuthingRedirectUri();
  const [deleteAuthingRequest, _deleteAuthingResponse, promptDeleteAuthingAsync] = AuthSession.useAuthRequest(
    {
      clientId: authingClientId,
      redirectUri: authingRedirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "email", "phone"],
      usePKCE: true,
      prompt: AuthSession.Prompt.Login,
    },
    authingDiscovery
  );

  // 判断用户是否已登录
  // 之前这里有一个强行停留1s的设定
  // 如果在登录页面强行停留1s。会让用户觉得我怎么又在登录页面
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        await Promise.all([initI18n(), preloadImages(PRELOAD_IMAGES)]);
        const installState = await reconcileLocalInstallState();
        const savedLanguage = await getSavedLanguage();
        if (savedLanguage) {
          setUiLocaleDraft(savedLanguage);
          await markLocalGuideCompleted(GUIDE_INITIAL_UI_LOCALE);
        }
        let session = await getSession();
        if (installState.isFreshInstall && session) {
          await clearSession();
          await clearAccountScopedStorage();
          session = null;
        }
        let preference: UserPreference | null = null;
        if (session) {
          preference = await getUserPreference().catch(() => null);
          if (preference) await setLanguage(preference.appLocale);
        }
        if (!mounted) return;
        setScreen(session ? "main" : "login");
        if (!session && !savedLanguage) {
          setUiLocaleSetupVisible(true);
        }
        if (session) {
          void runPostLoginGuideFlow(preference);
          void loadChatContacts();
        }
      } catch {
        if (!mounted) return;
        setScreen("login");
        setUiLocaleSetupVisible(true);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  // 监听登录失效
  useEffect(() => {
    return onSessionInvalid(() => {
      cancelDeleteAccountFlow();
      setScreen("login");
    });
  }, []);

  useEffect(() => {
    if (screen === "main" || screen === "practice" || screen === "me") {
      setSelectedTab(screen);
    }
  }, [screen]);

  async function handleLogout(): Promise<void> {
    cancelDeleteAccountFlow();
    const session = await getSession();
    if (session?.refreshToken) {
      try {
        await logout({ refreshToken: session.refreshToken });
      } catch {}
    }
    await clearSession();
    await clearAccountScopedStorage();
    await markForceAuthingLogin();
    setScreen("login");
  }

  async function handleLoginSuccess(): Promise<void> {
    cancelDeleteAccountFlow();
    setScreen("main");
    void loadChatContacts();
    void runPostLoginGuideFlow();
  }

  async function loadChatContacts(): Promise<void> {
    setContactsLoading(true);
    setContactsError(false);
    const cached = await loadCachedChatContacts();
    if (cached?.contacts.length) {
      setChatContacts(cached.contacts);
      setActiveContact((current) => cached.contacts.find((item) => item.id === current.id) ?? cached.contacts[0]);
    }
    try {
      const remote = await fetchChatContacts();
      setChatContacts((current) => {
        if (current.length && cached?.version === remote.version) return current;
        return remote.contacts;
      });
      setActiveContact((current) => remote.contacts.find((item) => item.id === current.id) ?? remote.contacts[0]);
    } catch {
      if (!cached?.contacts.length) setContactsError(true);
    } finally {
      setContactsLoading(false);
    }
  }

  async function runPostLoginGuideFlow(preloadedPreference?: UserPreference | null): Promise<void> {
    const preference = preloadedPreference ?? await getUserPreference().catch(() => null);
    const session = await getSession();
    const userId = preference?.userId ?? session?.user.id ?? null;
    setGuideStateUserId(userId);
    const localGuideState = await loadLocalGuideState(userId);
    const mergedGuideState = preference ? preference.guideState : localGuideState;
    setGuideState(mergedGuideState);
    await saveLocalGuideState(mergedGuideState, userId);
    const appLocale = getLanguage() as AppLocale;
    await updateUserPreference({ appLocale }).catch(() => null);

    if (preference) {
      setLearningLanguageDraft(preference.learningLanguage);
      setPromptDifficultyDraft(preference.promptDifficulty);
      setPromptStyleDraft(preference.promptStyle);
    }

    if (!isGuideCompleted(mergedGuideState, GUIDE_FIRST_LEARNING_SETUP)) {
      setLearningPreferenceVisible(true);
      return;
    }
    if (!isGuideCompleted(mergedGuideState, GUIDE_LEARNING_FLOW_HELP)) {
      setOnboardingHelpVisible(true);
    }
  }

  async function completeUiLocaleSetup(): Promise<void> {
    await setLanguage(uiLocaleDraft);
    await markLocalGuideCompleted(GUIDE_INITIAL_UI_LOCALE);
    setUiLocaleSetupVisible(false);
  }

  function applyAppLocale(value: AppLocale): void {
    setUiLocaleDraft(value);
    void setLanguage(value);
    bumpLanguageRevision((revision) => revision + 1);
  }

  async function completeLearningPreferenceSetup(): Promise<void> {
    if (learningPreferenceSaving) return;
    setLearningPreferenceSaving(true);
    try {
      const nextGuideState = completeGuide(guideState, GUIDE_FIRST_LEARNING_SETUP);
      const saved = await updateUserPreference({
        appLocale: getLanguage() as AppLocale,
        learningLanguage: learningLanguageDraft,
        promptDifficulty: promptDifficultyDraft,
        promptStyle: promptStyleDraft,
        guideState: nextGuideState,
      });
      setLearningLanguageDraft(saved.learningLanguage);
      setPromptDifficultyDraft(saved.promptDifficulty);
      setPromptStyleDraft(saved.promptStyle);
      setGuideState(saved.guideState);
      await saveLocalGuideState(saved.guideState, await resolveCurrentGuideUserId());
      setLearningPreferenceVisible(false);
      if (!isGuideCompleted(saved.guideState, GUIDE_LEARNING_FLOW_HELP)) {
        setOnboardingHelpVisible(true);
      }
    } catch {
      Alert.alert(t("me.language.save_failed_title"), t("me.language.save_failed_message"));
    } finally {
      setLearningPreferenceSaving(false);
    }
  }

  async function completeOnboardingHelp(): Promise<void> {
    const nextGuideState = completeGuide(guideState, GUIDE_LEARNING_FLOW_HELP);
    setGuideState(nextGuideState);
    await saveLocalGuideState(nextGuideState, await resolveCurrentGuideUserId());
    await updateUserPreference({ guideState: nextGuideState }).catch(() => null);
    setOnboardingHelpVisible(false);
  }

  async function resolveCurrentGuideUserId(): Promise<string | null> {
    if (guideStateUserId) return guideStateUserId;
    const session = await getSession();
    return session?.user.id ?? null;
  }

  async function handleDeleteAccount(): Promise<void> {
    Alert.alert(
      t("app.delete.title"),
      t("app.delete.message"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("app.delete.continue"),
          style: "destructive",
          onPress: () => {
            void startDeleteAccountVerification();
          },
        },
      ],
    );
  }

  async function startDeleteAccountVerification(): Promise<void> {
    if (!authingConfigured || !authingDiscovery || !deleteAuthingRequest) {
      Alert.alert(t("app.delete.unavailable_title"), t("app.delete.unavailable_message"));
      return;
    }
    if (deleteAccountLoading) return;

    const session = await getSession();
    const userId = session?.user.id;
    if (!userId) {
      Alert.alert(t("app.delete.login_required"));
      return;
    }

    const runId = ++deleteAccountRunIdRef.current;
    setDeleteAccountLoading(true);
    try {
      const result = await promptDeleteAuthingAsync();
      if (!(await isCurrentDeleteAccountRun(runId, userId))) return;
      if (result.type !== "success") {
        Alert.alert(t("app.delete.cancelled"));
        return;
      }
      const tokenResult = await AuthSession.exchangeCodeAsync(
        {
          clientId: authingClientId,
          code: result.params.code,
          redirectUri: authingRedirectUri,
          extraParams: { code_verifier: deleteAuthingRequest.codeVerifier ?? "" },
        },
        authingDiscovery,
      );
      if (!(await isCurrentDeleteAccountRun(runId, userId))) return;
      const prepared = await prepareDeleteAccount({ authingToken: tokenResult.accessToken });
      if (!(await isCurrentDeleteAccountRun(runId, userId))) return;
      setDeleteAccountAuthingToken(prepared.authingToken);
      setDeleteAccountMethod(prepared.method);
      setDeleteAccountTarget(prepared.target);
      setDeleteAccountCode("");
      setDeleteAccountUserId(userId);
      setDeleteAccountVisible(true);
    } catch {
      if (await isCurrentDeleteAccountRun(runId, userId)) {
        Alert.alert(t("app.delete.verify_failed_title"), t("app.delete.retry_later"));
      }
    } finally {
      if (await isCurrentDeleteAccountRun(runId, userId)) {
        setDeleteAccountLoading(false);
      }
    }
  }

  async function submitDeleteAccount(): Promise<void> {
    if (deleteAccountLoading) return;
    if (!deleteAccountAuthingToken || !deleteAccountMethod || !deleteAccountCode.trim()) {
      Alert.alert(t("app.delete.enter_code"));
      return;
    }

    const session = await getSession();
    if (!deleteAccountUserId || session?.user.id !== deleteAccountUserId) {
      cancelDeleteAccountFlow();
      Alert.alert(t("app.delete.expired_title"), t("app.delete.expired_message"));
      return;
    }

    const runId = deleteAccountRunIdRef.current;
    const userId = deleteAccountUserId;
    setDeleteAccountLoading(true);
    try {
      await confirmDeleteAccount({
        authingToken: deleteAccountAuthingToken,
        method: deleteAccountMethod,
        passCode: deleteAccountCode.trim(),
      });
      if (!(await isCurrentDeleteAccountRun(runId, userId))) return;
      setDeleteAccountVisible(false);
      resetDeleteAccountState();
      await clearSession();
      await clearAccountScopedStorage();
      await markForceAuthingLogin();
      setScreen("login");
      Alert.alert(t("app.delete.done"));
    } catch {
      if (await isCurrentDeleteAccountRun(runId, userId)) {
        Alert.alert(t("app.delete.failed_title"), t("app.delete.failed_message"));
      }
    } finally {
      if (await isCurrentDeleteAccountRun(runId, userId)) {
        setDeleteAccountLoading(false);
      }
    }
  }

  function resetDeleteAccountState(): void {
    setDeleteAccountAuthingToken("");
    setDeleteAccountMethod(null);
    setDeleteAccountTarget("");
    setDeleteAccountCode("");
    setDeleteAccountUserId("");
  }

  function cancelDeleteAccountFlow(): void {
    deleteAccountRunIdRef.current += 1;
    setDeleteAccountVisible(false);
    setDeleteAccountLoading(false);
    resetDeleteAccountState();
  }

  async function isCurrentDeleteAccountRun(runId: number, userId: string): Promise<boolean> {
    if (deleteAccountRunIdRef.current !== runId) return false;
    const session = await getSession();
    return session?.user.id === userId;
  }

  const showTabBar = screen === "main" || screen === "practice" || screen === "me";
  const activeTab = showTabBar ? screen : selectedTab;

  let content: React.ReactNode;
  if (screen === "booting") {
    content = <View style={styles.bootingScreen} />;
  }
  else if (screen === "login") {
    content = (
      <FadingScreen>
        <LoginScreen
          onLoginSuccess={() => {
            void handleLoginSuccess();
          }}
        />
      </FadingScreen>
    );
  }
  else {
    let overlay: React.ReactNode = null;
    if (screen === "chat") {
      overlay = (
        <FadingScreen>
          <ChatScreen contact={activeContact} onBack={() => setScreen("main")} />
        </FadingScreen>
      );
    } else if (screen === "practiceSession" && practiceSession) {
      overlay = (
        <FadingScreen>
          <PracticeSessionScreen
            initialCards={practiceSession.cards}
            allMessages={practiceSession.messages}
            onBack={() => setScreen("practice")}
          />
        </FadingScreen>
      );
    } else if (screen === "pro") {
      overlay = (
        <FadingScreen>
          <ProScreen onBack={() => setScreen("me")} />
        </FadingScreen>
      );
    } else if (screen === "about") {
      overlay = (
        <FadingScreen>
          <AboutScreen onBack={() => setScreen("me")} />
        </FadingScreen>
      );
    }

    content = (
      <View style={styles.appStack}>
        <FadingScreen>
          <TabScreens
            activeTab={activeTab}
            contacts={chatContacts}
            contactsLoading={contactsLoading}
            contactsError={contactsError}
            onReloadContacts={() => void loadChatContacts()}
            onOpenChat={(contact) => {
              setActiveContact(contact);
              setScreen("chat");
            }}
            onOpenPracticeSession={(cards, messages) => {
              setPracticeSession({ cards, messages });
              setScreen("practiceSession");
            }}
            onOpenPro={() => setScreen("pro")}
            onOpenAbout={() => setScreen("about")}
            onOpenHelp={() => setManualHelpVisible(true)}
            onApplyAppLocale={applyAppLocale}
            onLogout={handleLogout}
            onDeleteAccount={handleDeleteAccount}
          />
        </FadingScreen>
        {overlay ? <View style={styles.overlayScreen}>{overlay}</View> : null}
      </View>
    );
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <KeyboardProvider>
        <FloatingNoticeProvider>
          <View style={styles.screen}>
            <View style={styles.content}>{content}</View>
            <DeleteAccountModal
              visible={deleteAccountVisible}
              method={deleteAccountMethod}
              target={deleteAccountTarget}
              passCode={deleteAccountCode}
              loading={deleteAccountLoading}
              onChangePassCode={setDeleteAccountCode}
              onCancel={() => {
                if (deleteAccountLoading) return;
                setDeleteAccountVisible(false);
                resetDeleteAccountState();
              }}
              onSubmit={() => void submitDeleteAccount()}
            />
            <UiLocaleSetupModal
              visible={uiLocaleSetupVisible}
              value={uiLocaleDraft}
              onChange={(value) => {
                setUiLocaleDraft(value);
                void setLanguage(value);
              }}
              onContinue={() => void completeUiLocaleSetup()}
            />
            <LearningPreferenceModal
              visible={learningPreferenceVisible}
              learningLanguage={learningLanguageDraft}
              promptDifficulty={promptDifficultyDraft}
              promptStyle={promptStyleDraft}
              saving={learningPreferenceSaving}
              onChangeLearningLanguage={(value) => {
                setLearningLanguageDraft(value);
                setPromptStyleDraft("native_casual");
              }}
              onChangePromptDifficulty={setPromptDifficultyDraft}
              onChangePromptStyle={setPromptStyleDraft}
              onContinue={() => void completeLearningPreferenceSetup()}
            />
            <LearningFlowHelpModal
              visible={onboardingHelpVisible}
              mode="onboarding"
              onDone={() => void completeOnboardingHelp()}
            />
            <LearningFlowHelpModal
              visible={manualHelpVisible}
              mode="manual"
              onClose={() => setManualHelpVisible(false)}
              onDone={() => setManualHelpVisible(false)}
            />
            {showTabBar ? (
              <View style={styles.tabBarOverlay}>
                <TabBar
                  activeTab={activeTab}
                  onPressMain={() => setScreen("main")}
                  onPressPractice={() => setScreen("practice")}
                  onPressMe={() => setScreen("me")}
                />
              </View>
            ) : null}
          </View>
        </FloatingNoticeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function DeleteAccountModal({
  visible,
  method,
  target,
  passCode,
  loading,
  onChangePassCode,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  method: "PHONE_PASSCODE" | "EMAIL_PASSCODE" | null;
  target: string;
  passCode: string;
  loading: boolean;
  onChangePassCode: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const channelLabel = method === "EMAIL_PASSCODE" ? t("app.delete.channel.email") : t("app.delete.channel.phone");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.deleteBackdrop}>
        <View style={styles.deletePanel}>
          <Text style={styles.deleteTitle}>{t("app.delete.verify_title")}</Text>
          <Text style={styles.deleteDesc}>{tf("app.delete.verify_desc", { channel: channelLabel, target })}</Text>
          <TextInput
            style={styles.deleteInput}
            value={passCode}
            onChangeText={onChangePassCode}
            placeholder={t("app.delete.code_placeholder")}
            placeholderTextColor="#8A8E99"
            keyboardType="number-pad"
            editable={!loading}
          />
          <View style={styles.deleteActions}>
            <Pressable style={styles.deleteCancelButton} onPress={onCancel} disabled={loading}>
              <Text style={styles.deleteCancelText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable style={[styles.deleteSubmitButton, loading && styles.deleteButtonDisabled]} onPress={onSubmit} disabled={loading}>
              <Text style={styles.deleteSubmitText}>{loading ? t("app.delete.deleting") : t("app.delete.confirm")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FadingScreen({ children }: { children: React.ReactNode }) {
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 页面仍然正常挂载，只用极短的透明度淡入遮住首帧布局抖动。
    // 不做 Y 轴位移，也不延迟渲染内容，避免出现“页面从上往下掉”的感觉。
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 90,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={[styles.fadingScreen, { opacity }]}>{children}</Animated.View>;
}

function TabScreens({
  activeTab,
  contacts,
  contactsLoading,
  contactsError,
  onReloadContacts,
  onOpenChat,
  onOpenPracticeSession,
  onOpenPro,
  onOpenAbout,
  onOpenHelp,
  onApplyAppLocale,
  onLogout,
  onDeleteAccount,
}: {
  activeTab: "main" | "practice" | "me";
  contacts: ChatContact[];
  contactsLoading: boolean;
  contactsError: boolean;
  onReloadContacts: () => void;
  onOpenChat: (contact: ChatContact) => void;
  onOpenPracticeSession: (cards: PracticeCard[], allMessages: ChatMessage[]) => void;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onOpenHelp: () => void;
  onApplyAppLocale: (value: AppLocale) => void;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}) {
  return (
    <View style={styles.tabHost}>
      <View style={[styles.tabPage, activeTab !== "main" && styles.tabPageHidden]}>
        <MainScreen
          contacts={contacts}
          loadingContacts={contactsLoading}
          contactsError={contactsError}
          onReloadContacts={onReloadContacts}
          onOpenChat={onOpenChat}
        />
      </View>
      <View style={[styles.tabPage, activeTab !== "practice" && styles.tabPageHidden]}>
        <PracticeScreen isActive={activeTab === "practice"} onOpenPracticeSession={onOpenPracticeSession} />
      </View>
      <View style={[styles.tabPage, activeTab !== "me" && styles.tabPageHidden]}>
        <MeScreen
          isActive={activeTab === "me"}
          onOpenPro={onOpenPro}
          onOpenAbout={onOpenAbout}
          onOpenHelp={onOpenHelp}
          onApplyAppLocale={onApplyAppLocale}
          onLogout={onLogout}
          onDeleteAccount={onDeleteAccount}
        />
      </View>
    </View>
  );
}

async function preloadImages(images: Array<ReturnType<typeof require>>): Promise<void> {
  await Promise.all(
    images.map(async (image) => {
      const source = Image.resolveAssetSource(image);
      if (!source?.uri) return;
      try {
        await Image.prefetch(source.uri);
      } catch {}
    }),
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { flex: 1 },
  appStack: { flex: 1 },
  overlayScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FCFCFD",
    zIndex: 1,
    elevation: 1,
  },
  fadingScreen: { flex: 1, backgroundColor: "#FCFCFD" },
  tabHost: { flex: 1, paddingBottom: 86 },
  tabPage: { ...StyleSheet.absoluteFillObject },
  tabPageHidden: { display: "none" },
  tabBarOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  bootingScreen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  deleteBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: "rgba(17,17,17,0.38)",
    justifyContent: "center",
  },
  deletePanel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  deleteTitle: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "600",
  },
  deleteDesc: {
    marginTop: 8,
    color: "#5E6573",
    fontSize: 13,
    lineHeight: 19,
  },
  deleteInput: {
    marginTop: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FAFBFC",
    paddingHorizontal: 12,
    color: "#111111",
    fontSize: 15,
  },
  deleteActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  deleteCancelButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8DAE0",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteSubmitButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#C43D3D",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButtonDisabled: {
    opacity: 0.62,
  },
  deleteCancelText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "500",
  },
  deleteSubmitText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
