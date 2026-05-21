import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SplashGateScreen } from "./screens/SplashGateScreen";
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
import { onSessionInvalid } from "./services/auth/authSessionEvents";
import type { ChatMessage } from "./domain/chat/types";
import type { PracticeCard } from "./domain/practice/practiceService";
import {
  DEFAULT_CHAT_CONTACT,
  type ChatContact,
} from "./domain/chat/contacts";

type Screen = "splash" | "login" | "main" | "chat" | "practice" | "practiceSession" | "me" | "pro" | "about";

const PRELOAD_IMAGES = [require("../assets/app/logo.png")];

// 每次setScreen就重新执行App()，因为useState是代表状态值[值，该表状态值的函数]
export default function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [practiceSession, setPracticeSession] = useState<{
    cards: PracticeCard[];
    messages: ChatMessage[];
  } | null>(null);
  const [activeContact, setActiveContact] = useState<ChatContact>(DEFAULT_CHAT_CONTACT);

  // 初始化，决定进入main还是login页面
  useEffect(() => {
    let mounted = true;
    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async function bootstrap() {
      const startAt = Date.now();
      const MIN_SPLASH_MS = 1000;
      try {
        await Promise.all([initI18n(), preloadImages(PRELOAD_IMAGES)]);
        const session = await getSession();
        const elapsed = Date.now() - startAt;
        const remain = MIN_SPLASH_MS - elapsed;
        if (remain > 0) await sleep(remain);
        if (!mounted) return;
        setScreen(session ? "main" : "login");
      } catch {
        const elapsed = Date.now() - startAt;
        const remain = MIN_SPLASH_MS - elapsed;
        if (remain > 0) await sleep(remain);
        if (!mounted) return;
        setScreen("login");
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  // 订阅/取消订阅事件，跳回登录页。
  useEffect(() => {
    return onSessionInvalid(() => {
      setScreen("login");
    });
  }, []);

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

  // 导航逻辑
  let content: React.ReactNode;
  if (screen === "splash") content = <SplashGateScreen />;
  else if (screen === "login") content = <LoginScreen onLoginSuccess={() => setScreen("main")} />;
  else if (screen === "chat") content = <ChatScreen contact={activeContact} onBack={() => setScreen("main")} />;
  else if (screen === "practice") {
    content = (
      <PracticeScreen
        onOpenChat={() => {
          setActiveContact(DEFAULT_CHAT_CONTACT);
          setScreen("chat");
        }}
        onOpenMe={() => setScreen("me")}
        onOpenPracticeSession={(cards, messages) => {
          setPracticeSession({ cards, messages });
          setScreen("practiceSession");
        }}
      />
    );
  }
  else if (screen === "practiceSession" && practiceSession) {
    content = (
      <PracticeSessionScreen
        initialCards={practiceSession.cards}
        allMessages={practiceSession.messages}
        onBack={() => setScreen("practice")}
      />
    );
  } else if (screen === "me") {
    content = (
      <MeScreen
        onOpenMain={() => setScreen("main")}
        onOpenPractice={() => setScreen("practice")}
        onOpenPro={() => setScreen("pro")}
        onOpenAbout={() => setScreen("about")}
        onLogout={handleLogout}
      />
    );
  }
  else if (screen === "pro") content = <ProScreen onBack={() => setScreen("me")} />;
  else if (screen === "about") content = <AboutScreen onBack={() => setScreen("me")} />;
  else {
    content = (
      <MainScreen
        onOpenChat={(contact) => {
          setActiveContact(contact);
          setScreen("chat");
        }}
        onOpenPractice={() => setScreen("practice")}
        onOpenMe={() => setScreen("me")}
      />
    );
  }

  return (
    <KeyboardProvider>
      <FloatingNoticeProvider>
        <View style={styles.screen}>{content}</View>
      </FloatingNoticeProvider>
    </KeyboardProvider>
  );
}

async function preloadImages(images: Array<ReturnType<typeof require>>): Promise<void> {
  // 预加载首屏图片，降低登录页首次展示时的空白感。
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

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#FFFFFF" } });
