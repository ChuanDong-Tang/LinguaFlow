import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, AppState, Image, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as AuthSession from "expo-auth-session";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { LoginScreen } from "./screens/LoginScreen";
import { getLanguage, getSavedLanguage, initI18n, setLanguage, t, tf } from "./i18n";
import {
  clearAuthingAccessToken,
  clearSession,
  getAuthingAccessToken,
  getSession,
  markForceAuthingLogin,
  setAuthingAccessToken,
  setSession,
} from "./services/auth/authStorage";
import { clearAccountScopedStorage } from "./services/auth/accountScopedStorage";
import { reconcileLocalInstallState } from "./services/storage/installState";
import { ApiError, confirmBindEmail, confirmDeleteAccount, logout, prepareBindEmail, prepareDeleteAccount } from "./services/api/authApi";
import {
  getCurrentEntitlement,
  getUsageV2,
  getUserPreference,
  updateUserPreference,
  type AppLocale,
  type LearningLanguage,
  type PromptDifficulty,
  type UserPreference,
} from "./services/api/meApi";
import { setQuotaExhaustionHandler, type QuotaExhaustionKind } from "./services/usage/quotaExhaustion";
import { MainScreen } from "./screens/MainScreen";
import { MeScreen } from "./screens/MeScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { RecallScreen } from "./screens/RecallScreen";
import { hasStoredMemoryRound, MemoryRoundScreen } from "./screens/MemoryRoundScreen";
import {
  CardDetailNavigator,
  type CardDetailRequest,
} from "./screens/CardDetailNavigator";
import { AboutScreen } from "./screens/AboutScreen";
import { FloatingNoticeProvider } from "./screens/shared/FloatingNotice";
import { LearningPreferenceModal, UiLocaleSetupModal } from "./screens/shared/OnboardingModals";
import {
  completeGuide,
  GUIDE_FIRST_LEARNING_SETUP,
  GUIDE_INITIAL_UI_LOCALE,
  isGuideCompleted,
  loadLocalGuideState,
  markLocalGuideCompleted,
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
import type { User } from "@lf/core/types";
import {
  DEFAULT_CHAT_CONTACT,
  type ChatContact,
} from "./domain/chat/contacts";
import { fetchChatContacts, loadCachedChatContacts } from "./services/api/chatContactsApi";
import { theme } from "./theme";
import type { CardDraft } from "./services/card/cardDraftStorage";
import { getAvailableAppUpdate } from "./services/api/appVersionApi";

type Screen =
  | "booting"
  | "login"
  | "main"
  | "chat"
  | "practice"
  | "me"
  | "about";

const PRELOAD_IMAGES = [require("../assets/app/logo.png")];

export default function App() {
  const [screen, setScreen] = useState<Screen>("booting");
  const [selectedTab, setSelectedTab] = useState<"main" | "practice" | "me">("main");
  const [activeContact, setActiveContact] = useState<ChatContact>(DEFAULT_CHAT_CONTACT);
  const [chatContacts, setChatContacts] = useState<ChatContact[]>([]);
  const [, bumpLanguageRevision] = useState(0);
  const [uiLocaleSetupVisible, setUiLocaleSetupVisible] = useState(false);
  const [uiLocaleDraft, setUiLocaleDraft] = useState<AppLocale>("zh-CN");
  const [learningPreferenceVisible, setLearningPreferenceVisible] = useState(false);
  const [learningPreferenceSaving, setLearningPreferenceSaving] = useState(false);
  const [learningLanguageDraft, setLearningLanguageDraft] = useState<LearningLanguage>("en-US");
  const [promptDifficultyDraft, setPromptDifficultyDraft] = useState<PromptDifficulty>("native");
  const [guideState, setGuideState] = useState<GuideState>({});
  const [guideStateUserId, setGuideStateUserId] = useState<string | null>(null);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [cardDataRevision, setCardDataRevision] = useState(0);
  const [cardDetailRequest, setCardDetailRequest] = useState<CardDetailRequest | null>(null);
  const cardDetailRequestKeyRef = useRef(0);
  const [incomingCardDraft, setIncomingCardDraft] = useState<{ id: number; draft: CardDraft } | null>(null);
  const incomingCardDraftIdRef = useRef(0);
  const [accountSheetVisible, setAccountSheetVisible] = useState(false);
  const [quotaDialog, setQuotaDialog] = useState<{ message: string; showMembership: boolean } | null>(null);
  const [recallVisible, setRecallVisible] = useState(false);
  const [memoryRoundVisible, setMemoryRoundVisible] = useState(false);
  const [memoryRoundResumeAvailable, setMemoryRoundResumeAvailable] = useState(false);
  const [memoryRoundRefreshRevision, setMemoryRoundRefreshRevision] = useState(0);
  const [memoryRoundCurrentRecordId, setMemoryRoundCurrentRecordId] = useState<string | null>(null);
  const [recallLaunchRequest, setRecallLaunchRequest] = useState<{ key: number; mode: "today" | "yesterday" | "recent" | "blind" } | null>(null);
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteAccountAuthingToken, setDeleteAccountAuthingToken] = useState("");
  const [deleteAccountMethod, setDeleteAccountMethod] = useState<"PHONE_PASSCODE" | "EMAIL_PASSCODE" | null>(null);
  const [deleteAccountTarget, setDeleteAccountTarget] = useState("");
  const [deleteAccountCode, setDeleteAccountCode] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountUserId, setDeleteAccountUserId] = useState("");
  const deleteAccountRunIdRef = useRef(0);
  const [bindEmailVisible, setBindEmailVisible] = useState(false);
  const [bindEmailAuthingToken, setBindEmailAuthingToken] = useState("");
  const [bindEmailValue, setBindEmailValue] = useState("");
  const [bindEmailTarget, setBindEmailTarget] = useState("");
  const [bindEmailCode, setBindEmailCode] = useState("");
  const [bindEmailLoading, setBindEmailLoading] = useState(false);
  const [bindEmailUserId, setBindEmailUserId] = useState("");
  const bindEmailRunIdRef = useRef(0);
  const updateCheckRunningRef = useRef(false);
  const promptedUpdateVersionRef = useRef<string | null>(null);
  const appBooting = screen === "booting";
  const authingConfigured = isAuthingConfigured();

  useEffect(() => {
    void hasStoredMemoryRound().then(setMemoryRoundResumeAvailable).catch(() => undefined);
  }, [sessionRevision, cardDataRevision]);
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
  const [bindEmailAuthingRequest, _bindEmailAuthingResponse, promptBindEmailAuthingAsync] = AuthSession.useAuthRequest(
    {
      clientId: authingClientId,
      redirectUri: authingRedirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "email", "phone"],
      usePKCE: true,
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
          await clearAuthingAccessToken();
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

  useEffect(() => {
    if (appBooting) return;
    const check = async () => {
      if (updateCheckRunningRef.current) return;
      updateCheckRunningRef.current = true;
      try {
        const update = await getAvailableAppUpdate();
        if (!update || promptedUpdateVersionRef.current === update.latestVersion) return;
        promptedUpdateVersionRef.current = update.latestVersion;
        const openStore = () => void Linking.openURL(update.storeUrl).catch(() => undefined);
        Alert.alert(
          t("app_update.title"),
          tf("app_update.message", { version: update.latestVersion }),
          [
            { text: t("app_update.later"), style: "cancel" },
            { text: t("app_update.now"), onPress: openStore },
          ],
        );
      } catch {
        // Version checks must never block app startup or normal use.
      } finally {
        updateCheckRunningRef.current = false;
      }
    };

    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [appBooting]);

  // 监听登录失效
  useEffect(() => {
    return onSessionInvalid(() => {
      cancelDeleteAccountFlow();
      cancelBindEmailFlow();
      setAccountSheetVisible(false);
      setRecallVisible(false);
      setMemoryRoundVisible(false);
      setMemoryRoundResumeAvailable(false);
      setCardDetailRequest(null);
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
    cancelBindEmailFlow();
    setAccountSheetVisible(false);
    setRecallVisible(false);
    setMemoryRoundVisible(false);
    setMemoryRoundResumeAvailable(false);
    const session = await getSession();
    if (session?.refreshToken) {
      try {
        await logout({ refreshToken: session.refreshToken });
      } catch {}
    }
    await clearSession();
    await clearAuthingAccessToken();
    await clearAccountScopedStorage();
    await markForceAuthingLogin();
    setCardDetailRequest(null);
    setScreen("login");
  }

  function openCardDetail(
    recordId: string,
    initialTab: CardDetailRequest["initialTab"] = "review",
    origin?: CardDetailRequest["origin"],
    options?: { returnLabel?: string },
  ): void {
    cardDetailRequestKeyRef.current += 1;
    setCardDetailRequest({
      key: cardDetailRequestKeyRef.current,
      recordId,
      initialTab,
      origin,
      returnLabel: options?.returnLabel,
    });
  }

  function editRecallCard(recordId: string): void {
    cardDetailRequestKeyRef.current += 1;
    setCardDetailRequest({
      key: cardDetailRequestKeyRef.current,
      recordId,
      initialTab: "review",
      initialEditing: true,
      closeAfterEditing: true,
    });
  }

  async function handleLoginSuccess(): Promise<void> {
    cancelDeleteAccountFlow();
    setSessionRevision((value) => value + 1);
    setScreen("main");
    void loadChatContacts();
    void runPostLoginGuideFlow();
  }

  async function loadChatContacts(): Promise<void> {
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
    } catch {}
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
    }

    if (!isGuideCompleted(mergedGuideState, GUIDE_FIRST_LEARNING_SETUP)) {
      setLearningPreferenceVisible(true);
      return;
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
        guideState: nextGuideState,
      });
      setLearningLanguageDraft(saved.learningLanguage);
      setPromptDifficultyDraft(saved.promptDifficulty);
      setGuideState(saved.guideState);
      await saveLocalGuideState(saved.guideState, await resolveCurrentGuideUserId());
      setLearningPreferenceVisible(false);
    } catch {
      Alert.alert(t("me.language.save_failed_title"), t("me.language.save_failed_message"));
    } finally {
      setLearningPreferenceSaving(false);
    }
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
      await clearAuthingAccessToken();
      await clearAccountScopedStorage();
      await markForceAuthingLogin();
      setRecallVisible(false);
      setMemoryRoundVisible(false);
      setMemoryRoundResumeAvailable(false);
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

  async function handleBindEmail(): Promise<void> {
    const session = await getSession();
    if (!session?.user.id) {
      Alert.alert(t("app.bind_email.login_required"));
      return;
    }
    if (session.user.email?.trim()) {
      Alert.alert(t("me.bind_email.already_title"), tf("me.bind_email.already_message", { email: session.user.email.trim() }));
      return;
    }
    bindEmailRunIdRef.current += 1;
    setBindEmailUserId(session.user.id);
    setBindEmailValue("");
    setBindEmailTarget("");
    setBindEmailCode("");
    setBindEmailAuthingToken("");
    setBindEmailVisible(true);
  }

  async function sendBindEmailCode(): Promise<void> {
    if (bindEmailLoading) return;
    const email = bindEmailValue.trim();
    if (!email) {
      Alert.alert(t("app.bind_email.enter_email"));
      return;
    }

    const session = await getSession();
    if (!bindEmailUserId || session?.user.id !== bindEmailUserId) {
      cancelBindEmailFlow();
      Alert.alert(t("app.bind_email.expired_title"), t("app.bind_email.expired_message"));
      return;
    }

    const runId = bindEmailRunIdRef.current;
    const userId = bindEmailUserId;
    setBindEmailLoading(true);
    try {
      const authingToken = await resolveBindEmailAuthingToken();
      if (!(await isCurrentBindEmailRun(runId, userId))) return;
      const prepared = await prepareBindEmailWithReauthFallback(authingToken, email);
      if (!(await isCurrentBindEmailRun(runId, userId))) return;
      setBindEmailAuthingToken(prepared.authingToken);
      setBindEmailValue(prepared.email);
      setBindEmailTarget(prepared.target);
      setBindEmailCode("");
      Alert.alert(t("app.bind_email.code_sent_title"), tf("app.bind_email.code_sent_message", { target: prepared.target }));
    } catch (error) {
      if (await isCurrentBindEmailRun(runId, userId)) {
        Alert.alert(t("app.bind_email.send_failed_title"), normalizeUserFacingError(error, t("app.bind_email.retry_later")));
      }
    } finally {
      if (await isCurrentBindEmailRun(runId, userId)) {
        setBindEmailLoading(false);
      }
    }
  }

  async function resolveBindEmailAuthingToken(): Promise<string> {
    const cachedToken = await getAuthingAccessToken();
    if (cachedToken) return cachedToken;
    return requestFreshBindEmailAuthingToken();
  }

  async function prepareBindEmailWithReauthFallback(authingToken: string, email: string) {
    try {
      return await prepareBindEmail({ authingToken, email });
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "AUTHING_REAUTH_REQUIRED") {
        throw error;
      }
      await clearAuthingAccessToken();
      const freshToken = await requestFreshBindEmailAuthingToken();
      return prepareBindEmail({ authingToken: freshToken, email });
    }
  }

  async function requestFreshBindEmailAuthingToken(): Promise<string> {
    if (!authingConfigured || !authingDiscovery || !bindEmailAuthingRequest) {
      throw new Error(t("app.bind_email.unavailable_message"));
    }

    const result = await promptBindEmailAuthingAsync();
    if (result.type !== "success") {
      throw new Error(t("common.operation_cancelled"));
    }

    const tokenResult = await AuthSession.exchangeCodeAsync(
      {
        clientId: authingClientId,
        code: result.params.code,
        redirectUri: authingRedirectUri,
        extraParams: { code_verifier: bindEmailAuthingRequest.codeVerifier ?? "" },
      },
      authingDiscovery,
    );
    await setAuthingAccessToken(tokenResult.accessToken);
    return tokenResult.accessToken;
  }

  async function confirmBindEmailWithReauthFallback(input: {
    authingToken: string;
    email: string;
    passCode: string;
  }) {
    try {
      return await confirmBindEmail(input);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "AUTHING_REAUTH_REQUIRED") {
        throw error;
      }
      await clearAuthingAccessToken();
      const freshToken = await requestFreshBindEmailAuthingToken();
      setBindEmailAuthingToken(freshToken);
      return confirmBindEmail({ ...input, authingToken: freshToken });
    }
  }

  async function submitBindEmail(): Promise<void> {
    if (bindEmailLoading) return;
    if (!bindEmailAuthingToken || !bindEmailValue.trim()) {
      await sendBindEmailCode();
      return;
    }
    if (!bindEmailCode.trim()) {
      Alert.alert(t("app.bind_email.enter_code"));
      return;
    }

    const session = await getSession();
    if (!bindEmailUserId || session?.user.id !== bindEmailUserId) {
      cancelBindEmailFlow();
      Alert.alert(t("app.bind_email.expired_title"), t("app.bind_email.expired_message"));
      return;
    }

    const runId = bindEmailRunIdRef.current;
    const userId = bindEmailUserId;
    setBindEmailLoading(true);
    try {
      const result = await confirmBindEmailWithReauthFallback({
        authingToken: bindEmailAuthingToken,
        email: bindEmailValue,
        passCode: bindEmailCode.trim(),
      });
      if (!(await isCurrentBindEmailRun(runId, userId))) return;
      const currentSession = await getSession();
      if (!currentSession || currentSession.user.id !== userId) return;
      await setSession({
        ...currentSession,
        user: toSessionUser(result.user),
      });
      setSessionRevision((revision) => revision + 1);
      setBindEmailVisible(false);
      resetBindEmailState();
      Alert.alert(t("app.bind_email.done_title"), tf("app.bind_email.done_message", { email: result.user.email ?? bindEmailValue }));
    } catch (error) {
      if (await isCurrentBindEmailRun(runId, userId)) {
        Alert.alert(t("app.bind_email.failed_title"), normalizeUserFacingError(error, t("app.bind_email.failed_message")));
      }
    } finally {
      if (await isCurrentBindEmailRun(runId, userId)) {
        setBindEmailLoading(false);
      }
    }
  }

  function resetBindEmailState(): void {
    setBindEmailAuthingToken("");
    setBindEmailValue("");
    setBindEmailTarget("");
    setBindEmailCode("");
    setBindEmailUserId("");
  }

  function cancelBindEmailFlow(): void {
    bindEmailRunIdRef.current += 1;
    setBindEmailVisible(false);
    setBindEmailLoading(false);
    resetBindEmailState();
  }

  async function isCurrentBindEmailRun(runId: number, userId: string): Promise<boolean> {
    if (bindEmailRunIdRef.current !== runId) return false;
    const session = await getSession();
    return session?.user.id === userId;
  }

  async function handleQuotaExhaustion(kind: QuotaExhaustionKind): Promise<void> {
    setMemoryRoundVisible(false);
    setRecallVisible(false);
    setRecallLaunchRequest(null);
    setCardDetailRequest(null);
    setScreen("main");
    setSelectedTab("main");
    const [entitlement, usage] = await Promise.all([
      getCurrentEntitlement().catch(() => null),
      getUsageV2().catch(() => null),
    ]);
    const isMember = (entitlement?.isMember ?? entitlement?.isPro) === true;
    if (!isMember) {
      setQuotaDialog({
        message: t(kind === "token" ? "chat.error.quota_free_empty" : "image.error.quota_free_empty"),
        showMembership: true,
      });
      return;
    }
    const refreshAt = kind === "token" ? usage?.token.periodEnd : usage?.images.periodEnd;
    setQuotaDialog({
      message: tf(
        kind === "token" ? "chat.error.quota_member_empty" : "image.error.quota_member_empty",
        { time: formatQuotaRefreshTime(refreshAt ?? null) },
      ),
      showMembership: false,
    });
  }

  useEffect(() => setQuotaExhaustionHandler((kind) => {
    void handleQuotaExhaustion(kind);
  }), []);

  const activeTab = screen === "main" || screen === "practice" || screen === "me" ? screen : selectedTab;

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
          <ChatScreen
            contact={activeContact}
            onBack={() => setScreen("main")}
            onOpenCard={(recordId) => {
              setScreen("main");
              openCardDetail(recordId, "review");
            }}
            onConvertMessageToCard={(draft) => {
              incomingCardDraftIdRef.current += 1;
              setIncomingCardDraft({ id: incomingCardDraftIdRef.current, draft });
              setScreen("main");
            }}
          />
        </FadingScreen>
      );
    } else if (screen === "about") {
      overlay = (
        <FadingScreen>
          <AboutScreen onBack={() => { setScreen("main"); setAccountSheetVisible(true); }} />
        </FadingScreen>
      );
    }

    content = (
      <View style={styles.appStack}>
        <FadingScreen>
          <TabScreens
            activeTab={activeTab}
            contacts={chatContacts}
            onOpenChat={(contact) => {
              setActiveContact(contact);
              setScreen("chat");
            }}
            onOpenAbout={() => setScreen("about")}
            onApplyAppLocale={applyAppLocale}
            sessionRevision={sessionRevision}
            onBindEmail={handleBindEmail}
            onLogout={handleLogout}
            onDeleteAccount={handleDeleteAccount}
            cardDataRevision={cardDataRevision}
            incomingCardDraft={incomingCardDraft}
            onIncomingCardDraftHandled={(id) => setIncomingCardDraft((current) => current?.id === id ? null : current)}
            onOpenCard={openCardDetail}
            onEditRecallCard={editRecallCard}
            onCardChanged={() => setCardDataRevision((value) => value + 1)}
            onOpenLibrary={() => setScreen("main")}
            onOpenRecall={(mode) => {
              setRecallLaunchRequest(mode ? { key: Date.now(), mode } : null);
              setRecallVisible(true);
            }}
            onOpenMemoryRound={() => setMemoryRoundVisible(true)}
            memoryRoundResumeAvailable={memoryRoundResumeAvailable}
            onOpenAccount={() => setAccountSheetVisible(true)}
          />
        </FadingScreen>
        {recallVisible ? (
          <View style={styles.overlayScreen}>
            <RecallScreen
              isActive
              launchRequest={recallLaunchRequest}
              refreshRevision={cardDataRevision}
              onEditCard={editRecallCard}
              onCardChanged={() => setCardDataRevision((value) => value + 1)}
              onOpenLibrary={() => {
                setRecallVisible(false);
                setRecallLaunchRequest(null);
              }}
              onOpenMemoryRound={() => setMemoryRoundVisible(true)}
              memoryRoundResumeAvailable={memoryRoundResumeAvailable}
            />
          </View>
        ) : null}
        {memoryRoundVisible ? (
          <View style={[styles.overlayScreen, styles.memoryRoundOverlay]}>
            <MemoryRoundScreen
              onClose={() => setMemoryRoundVisible(false)}
              onOpenCard={(recordId) => openCardDetail(recordId, "review", undefined, { returnLabel: t("memory_round.title") })}
              onOpenLibrary={() => {
                setMemoryRoundVisible(false);
                setRecallVisible(false);
                setRecallLaunchRequest(null);
                setScreen("main");
              }}
              onResumeStateChange={setMemoryRoundResumeAvailable}
              onCardChanged={() => setCardDataRevision((value) => value + 1)}
              onCurrentCardChange={setMemoryRoundCurrentRecordId}
              refreshRevision={memoryRoundRefreshRevision}
            />
          </View>
        ) : null}
        {overlay ? <View style={styles.overlayScreen}>{overlay}</View> : null}
        <CardDetailNavigator
          request={cardDetailRequest}
          prefetchRecordId={memoryRoundVisible ? memoryRoundCurrentRecordId : null}
          onClose={() => {
            const returningToMemoryRound = memoryRoundVisible && Boolean(cardDetailRequest?.returnLabel);
            setCardDetailRequest(null);
            if (returningToMemoryRound) setMemoryRoundRefreshRevision((value) => value + 1);
          }}
          onChanged={() => setCardDataRevision((value) => value + 1)}
        />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
            <BindEmailModal
              visible={bindEmailVisible && !accountSheetVisible}
              email={bindEmailValue}
              target={bindEmailTarget}
              passCode={bindEmailCode}
              loading={bindEmailLoading}
              onChangeEmail={setBindEmailValue}
              onChangePassCode={setBindEmailCode}
              onCancel={cancelBindEmailFlow}
              onSendCode={() => void sendBindEmailCode()}
              onSubmit={() => void submitBindEmail()}
            />
            <Modal
              visible={accountSheetVisible}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => setAccountSheetVisible(false)}
            >
              <MeScreen
                isActive={accountSheetVisible}
                onClose={() => setAccountSheetVisible(false)}
                onOpenAbout={() => {
                  setAccountSheetVisible(false);
                  setScreen("about");
                }}
                onApplyAppLocale={applyAppLocale}
                sessionRevision={sessionRevision}
                onBindEmail={handleBindEmail}
                onLogout={handleLogout}
                onDeleteAccount={handleDeleteAccount}
              />
              <BindEmailModal
                visible={bindEmailVisible}
                email={bindEmailValue}
                target={bindEmailTarget}
                passCode={bindEmailCode}
                loading={bindEmailLoading}
                onChangeEmail={setBindEmailValue}
                onChangePassCode={setBindEmailCode}
                onCancel={cancelBindEmailFlow}
                onSendCode={() => void sendBindEmailCode()}
                onSubmit={() => void submitBindEmail()}
              />
            </Modal>
            <QuotaExhaustionDialog
              value={quotaDialog}
              onClose={() => setQuotaDialog(null)}
              onViewMembership={() => {
                setQuotaDialog(null);
                setAccountSheetVisible(true);
              }}
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
              saving={learningPreferenceSaving}
              onChangeLearningLanguage={setLearningLanguageDraft}
              onChangePromptDifficulty={setPromptDifficultyDraft}
              onContinue={() => void completeLearningPreferenceSetup()}
            />
          </View>
        </FloatingNoticeProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function QuotaExhaustionDialog({
  value,
  onClose,
  onViewMembership,
}: {
  value: { message: string; showMembership: boolean } | null;
  onClose: () => void;
  onViewMembership: () => void;
}) {
  return (
    <Modal visible={Boolean(value)} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.quotaDialogBackdrop}>
        <Pressable accessibilityLabel={t("common.cancel")} style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.quotaDialogPanel}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={10} style={styles.quotaDialogClose} onPress={onClose}>
            <Ionicons name="close" size={21} color={theme.colors.textSecondary} />
          </Pressable>
          <Text style={styles.quotaDialogMessage}>{value?.message ?? ""}</Text>
          {value?.showMembership ? (
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.quotaDialogMembershipButton, pressed && styles.quotaDialogButtonPressed]} onPress={onViewMembership}>
              <Text style={styles.quotaDialogMembershipText}>{t("quota.action.view_membership")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
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

function BindEmailModal({
  visible,
  email,
  target,
  passCode,
  loading,
  onChangeEmail,
  onChangePassCode,
  onCancel,
  onSendCode,
  onSubmit,
}: {
  visible: boolean;
  email: string;
  target: string;
  passCode: string;
  loading: boolean;
  onChangeEmail: (value: string) => void;
  onChangePassCode: (value: string) => void;
  onCancel: () => void;
  onSendCode: () => void;
  onSubmit: () => void;
}) {
  const codeSent = Boolean(target);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.deleteBackdrop}>
        <View style={styles.deletePanel}>
          <Text style={styles.deleteTitle}>{t("app.bind_email.title")}</Text>
          <Text style={styles.deleteDesc}>
            {codeSent ? tf("app.bind_email.verify_desc", { target }) : t("app.bind_email.input_desc")}
          </Text>
          <TextInput
            style={styles.deleteInput}
            value={email}
            onChangeText={onChangeEmail}
            placeholder={t("app.bind_email.email_placeholder")}
            placeholderTextColor="#8A8E99"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading && !codeSent}
          />
          {codeSent ? (
            <TextInput
              style={styles.deleteInput}
              value={passCode}
              onChangeText={onChangePassCode}
              placeholder={t("app.bind_email.code_placeholder")}
              placeholderTextColor="#8A8E99"
              keyboardType="number-pad"
              editable={!loading}
            />
          ) : null}
          <View style={styles.deleteActions}>
            <Pressable style={styles.deleteCancelButton} onPress={onCancel} disabled={loading}>
              <Text style={styles.deleteCancelText}>{t("common.cancel")}</Text>
            </Pressable>
            <Pressable
              style={[styles.bindEmailSubmitButton, loading && styles.deleteButtonDisabled]}
              onPress={codeSent ? onSubmit : onSendCode}
              disabled={loading}
            >
              <Text style={styles.deleteSubmitText}>
                {loading
                  ? t("common.saving")
                  : codeSent
                    ? t("app.bind_email.confirm")
                    : t("app.bind_email.send_code")}
              </Text>
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

function normalizeUserFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (!message || message.length > 100) return fallback;
  return message;
}

function toSessionUser(user: {
  id: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role?: "user" | "admin";
  createdAt: Date | string;
  updatedAt: Date | string;
}): User {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    wechatOpenId: null,
    displayName: user.nickname?.trim() || user.email?.trim() || user.phone?.trim() || null,
    avatarUrl: user.avatarUrl,
    role: user.role ?? "user",
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: new Date(user.updatedAt).toISOString(),
  };
}

function TabScreens({
  activeTab,
  contacts,
  onOpenChat,
  onOpenAbout,
  onApplyAppLocale,
  sessionRevision,
  onBindEmail,
  onLogout,
  onDeleteAccount,
  cardDataRevision,
  incomingCardDraft,
  onIncomingCardDraftHandled,
  onOpenCard,
  onEditRecallCard,
  onCardChanged,
  onOpenLibrary,
  onOpenRecall,
  onOpenMemoryRound,
  memoryRoundResumeAvailable,
  onOpenAccount,
}: {
  activeTab: "main" | "practice" | "me";
  contacts: ChatContact[];
  onOpenChat: (contact: ChatContact) => void;
  onOpenAbout: () => void;
  onApplyAppLocale: (value: AppLocale) => void;
  sessionRevision: number;
  onBindEmail: () => Promise<void>;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  cardDataRevision: number;
  incomingCardDraft: { id: number; draft: CardDraft } | null;
  onIncomingCardDraftHandled: (id: number) => void;
  onOpenCard: (recordId: string, initialTab?: CardDetailRequest["initialTab"], origin?: CardDetailRequest["origin"], options?: { returnLabel?: string }) => void;
  onEditRecallCard: (recordId: string) => void;
  onCardChanged: () => void;
  onOpenLibrary: () => void;
  onOpenRecall: (mode?: "today" | "yesterday" | "recent" | "blind") => void;
  onOpenMemoryRound: () => void;
  memoryRoundResumeAvailable: boolean;
  onOpenAccount: () => void;
}) {
  return (
    <View style={styles.tabHost}>
      <View style={[styles.tabPage, activeTab !== "main" && styles.tabPageHidden]}>
        <MainScreen
          isActive={activeTab === "main"}
          refreshRevision={cardDataRevision}
          incomingCardDraft={incomingCardDraft}
          onIncomingCardDraftHandled={onIncomingCardDraftHandled}
          onOpenCard={onOpenCard}
          onOpenRecall={onOpenRecall}
          onOpenMemoryRound={onOpenMemoryRound}
          memoryRoundResumeAvailable={memoryRoundResumeAvailable}
          onOpenAssistant={() => onOpenChat(contacts[0] ?? DEFAULT_CHAT_CONTACT)}
          onOpenAccount={onOpenAccount}
        />
      </View>
      <View style={[styles.tabPage, activeTab !== "practice" && styles.tabPageHidden]}>
        <RecallScreen
          isActive={activeTab === "practice"}
          refreshRevision={cardDataRevision}
          onEditCard={onEditRecallCard}
          onCardChanged={onCardChanged}
          onOpenLibrary={onOpenLibrary}
          onOpenMemoryRound={onOpenMemoryRound}
          memoryRoundResumeAvailable={memoryRoundResumeAvailable}
        />
      </View>
      <View style={[styles.tabPage, activeTab !== "me" && styles.tabPageHidden]}>
        <MeScreen
          isActive={activeTab === "me"}
          onOpenAbout={onOpenAbout}
          onApplyAppLocale={onApplyAppLocale}
          sessionRevision={sessionRevision}
          onBindEmail={onBindEmail}
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

function formatQuotaRefreshTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(getLanguage(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const styles = StyleSheet.create({
  quotaDialogBackdrop: { flex: 1, paddingHorizontal: 28, backgroundColor: "rgba(26,31,29,0.28)", alignItems: "center", justifyContent: "center" },
  quotaDialogPanel: { width: "100%", maxWidth: 360, paddingHorizontal: 22, paddingTop: 42, paddingBottom: 20, borderRadius: 24, backgroundColor: theme.colors.surface, shadowColor: "#1B2822", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  quotaDialogClose: { position: "absolute", top: 14, right: 14, width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  quotaDialogMessage: { color: theme.colors.text, fontSize: 16, lineHeight: 24, fontWeight: "500" },
  quotaDialogMembershipButton: { height: 48, marginTop: 22, borderRadius: 15, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  quotaDialogMembershipText: { color: theme.colors.surface, fontSize: 16, fontWeight: "600" },
  quotaDialogButtonPressed: { opacity: 0.82 },
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  content: { flex: 1 },
  appStack: { flex: 1 },
  overlayScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FCFCFD",
    zIndex: 1,
    elevation: 1,
  },
  memoryRoundOverlay: { zIndex: 2, elevation: 2 },
  fadingScreen: { flex: 1, backgroundColor: "#FCFCFD" },
  tabHost: { flex: 1 },
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
  bindEmailSubmitButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.accentStrong,
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
