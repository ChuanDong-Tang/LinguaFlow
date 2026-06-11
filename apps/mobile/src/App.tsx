import React, { useEffect, useState } from "react";
import { Alert, Animated, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as AuthSession from "expo-auth-session";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { LoginScreen } from "./screens/LoginScreen";
import { initI18n } from "./i18n";
import { clearSession, getSession, markForceAuthingLogin } from "./services/auth/authStorage";
import { confirmDeleteAccount, logout, prepareDeleteAccount } from "./services/api/authApi";
import { MainScreen } from "./screens/MainScreen";
import { MeScreen } from "./screens/MeScreen";
import { ProScreen } from "./screens/ProScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { PracticeSessionScreen } from "./screens/PracticeSessionScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { FloatingNoticeProvider } from "./screens/shared/FloatingNotice";
import { TabBar } from "./screens/shared/TabBar";
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
  const [deleteAccountVisible, setDeleteAccountVisible] = useState(false);
  const [deleteAccountAuthingToken, setDeleteAccountAuthingToken] = useState("");
  const [deleteAccountMethod, setDeleteAccountMethod] = useState<"PHONE_PASSCODE" | "EMAIL_PASSCODE" | null>(null);
  const [deleteAccountTarget, setDeleteAccountTarget] = useState("");
  const [deleteAccountCode, setDeleteAccountCode] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
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
        const session = await getSession();
        if (!mounted) return;
        setScreen(session ? "main" : "login");
      } catch {
        if (!mounted) return;
        setScreen("login");
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
      setScreen("login");
    });
  }, []);

  useEffect(() => {
    if (screen === "main" || screen === "practice" || screen === "me") {
      setSelectedTab(screen);
    }
  }, [screen]);

  async function handleLogout(): Promise<void> {
    const session = await getSession();
    if (session?.refreshToken) {
      try {
        await logout({ refreshToken: session.refreshToken });
      } catch {}
    }
    await clearSession();
    await markForceAuthingLogin();
    setScreen("login");
  }

  async function handleDeleteAccount(): Promise<void> {
    Alert.alert(
      "注销账号",
      "注销后当前账号将无法继续使用。再次用同一手机号或邮箱注册，会作为新账号进入。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "继续",
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
      Alert.alert("暂时无法注销", "Authing 登录尚未准备好，请稍后重试");
      return;
    }
    if (deleteAccountLoading) return;

    setDeleteAccountLoading(true);
    try {
      const result = await promptDeleteAuthingAsync();
      if (result.type !== "success") {
        Alert.alert("已取消注销验证");
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
      const prepared = await prepareDeleteAccount({ authingToken: tokenResult.accessToken });
      setDeleteAccountAuthingToken(prepared.authingToken);
      setDeleteAccountMethod(prepared.method);
      setDeleteAccountTarget(prepared.target);
      setDeleteAccountCode("");
      setDeleteAccountVisible(true);
    } catch {
      Alert.alert("注销验证失败", "请稍后重试");
    } finally {
      setDeleteAccountLoading(false);
    }
  }

  async function submitDeleteAccount(): Promise<void> {
    if (deleteAccountLoading) return;
    if (!deleteAccountAuthingToken || !deleteAccountMethod || !deleteAccountCode.trim()) {
      Alert.alert("请输入验证码");
      return;
    }

    setDeleteAccountLoading(true);
    try {
      await confirmDeleteAccount({
        authingToken: deleteAccountAuthingToken,
        method: deleteAccountMethod,
        passCode: deleteAccountCode.trim(),
      });
      setDeleteAccountVisible(false);
      resetDeleteAccountState();
      await clearSession();
      await markForceAuthingLogin();
      setScreen("login");
      Alert.alert("账号已注销");
    } catch {
      Alert.alert("注销失败", "请确认验证码后重试");
    } finally {
      setDeleteAccountLoading(false);
    }
  }

  function resetDeleteAccountState(): void {
    setDeleteAccountAuthingToken("");
    setDeleteAccountMethod(null);
    setDeleteAccountTarget("");
    setDeleteAccountCode("");
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
        <LoginScreen onLoginSuccess={() => setScreen("main")} />
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
  const channelLabel = method === "EMAIL_PASSCODE" ? "邮箱" : "手机";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.deleteBackdrop}>
        <View style={styles.deletePanel}>
          <Text style={styles.deleteTitle}>验证后注销账号</Text>
          <Text style={styles.deleteDesc}>验证码已发送到{channelLabel} {target}。验证通过后将立即注销账号。</Text>
          <TextInput
            style={styles.deleteInput}
            value={passCode}
            onChangeText={onChangePassCode}
            placeholder="验证码"
            placeholderTextColor="#8A8E99"
            keyboardType="number-pad"
            editable={!loading}
          />
          <View style={styles.deleteActions}>
            <Pressable style={styles.deleteCancelButton} onPress={onCancel} disabled={loading}>
              <Text style={styles.deleteCancelText}>取消</Text>
            </Pressable>
            <Pressable style={[styles.deleteSubmitButton, loading && styles.deleteButtonDisabled]} onPress={onSubmit} disabled={loading}>
              <Text style={styles.deleteSubmitText}>{loading ? "注销中..." : "确认注销"}</Text>
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
  onOpenChat,
  onOpenPracticeSession,
  onOpenPro,
  onOpenAbout,
  onLogout,
  onDeleteAccount,
}: {
  activeTab: "main" | "practice" | "me";
  onOpenChat: (contact: ChatContact) => void;
  onOpenPracticeSession: (cards: PracticeCard[], allMessages: ChatMessage[]) => void;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}) {
  return (
    <View style={styles.tabHost}>
      <View style={[styles.tabPage, activeTab !== "main" && styles.tabPageHidden]}>
        <MainScreen onOpenChat={onOpenChat} />
      </View>
      <View style={[styles.tabPage, activeTab !== "practice" && styles.tabPageHidden]}>
        <PracticeScreen isActive={activeTab === "practice"} onOpenPracticeSession={onOpenPracticeSession} />
      </View>
      <View style={[styles.tabPage, activeTab !== "me" && styles.tabPageHidden]}>
        <MeScreen
          isActive={activeTab === "me"}
          onOpenPro={onOpenPro}
          onOpenAbout={onOpenAbout}
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
