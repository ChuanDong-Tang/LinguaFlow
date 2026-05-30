import React, { useEffect, useState } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { LoginScreen } from "./screens/LoginScreen";
import { initI18n } from "./i18n";
import { clearSession, getSession, markForceAuthingLogin } from "./services/auth/authStorage";
import { logout } from "./services/api/authApi";
import { MainScreen } from "./screens/MainScreen";
import { MeScreen } from "./screens/MeScreen";
import { ProScreen } from "./screens/ProScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { PracticeScreen } from "./screens/PracticeScreen";
import { PracticeSessionScreen } from "./screens/PracticeSessionScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { FloatingNoticeProvider } from "./screens/shared/FloatingNotice";
import { TabBar } from "./screens/shared/TabBar";
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
}: {
  activeTab: "main" | "practice" | "me";
  onOpenChat: (contact: ChatContact) => void;
  onOpenPracticeSession: (cards: PracticeCard[], allMessages: ChatMessage[]) => void;
  onOpenPro: () => void;
  onOpenAbout: () => void;
  onLogout: () => Promise<void>;
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
        <MeScreen isActive={activeTab === "me"} onOpenPro={onOpenPro} onOpenAbout={onOpenAbout} onLogout={onLogout} />
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
  overlayScreen: { ...StyleSheet.absoluteFillObject },
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
});
