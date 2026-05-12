import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SplashGateScreen } from "./screens/SplashGateScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { initI18n } from "./i18n";
import { clearSession, getSession, markForceAuthingLogin } from "./services/authStorage";
import { logout } from "./services/authApi";
import { MainScreen } from "./screens/MainScreen";
import { MeScreen } from "./screens/MeScreen";
import { ProScreen } from "./screens/ProScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { AboutScreen } from "./screens/AboutScreen";
import { onSessionInvalid } from "./services/authSessionEvents";

type Screen = "splash" | "login" | "main" | "chat" | "me" | "pro" | "about";

const PRELOAD_IMAGES = [require("../assets/app/logo.png")];

export default function App() {
  const [screen, setScreen] = useState<Screen>("splash");

  useEffect(() => {
    let mounted = true;
    function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
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
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    return onSessionInvalid(() => {
      setScreen("login");
    });
  }, []);

  async function handleLogout(): Promise<void> {
    const session = await getSession();
    if (session?.refreshToken) {
      try { await logout({ refreshToken: session.refreshToken }); } catch {}
    }
    await clearSession();
    await markForceAuthingLogin();
    setScreen("login");
  }

  let content: React.ReactNode;
  if (screen === "splash") content = <SplashGateScreen />;
  else if (screen === "login") content = <LoginScreen onLoginSuccess={() => setScreen("main")} />;
  else if (screen === "chat") content = <ChatScreen onBack={() => setScreen("main")} />;
  else if (screen === "me") content = <MeScreen onOpenMain={() => setScreen("main")} onOpenPro={() => setScreen("pro")} onOpenAbout={() => setScreen("about")} onLogout={handleLogout} />;
  else if (screen === "pro") content = <ProScreen onBack={() => setScreen("me")} />;
  else if (screen === "about") content = <AboutScreen onBack={() => setScreen("me")} />;
  else content = <MainScreen onOpenChat={() => setScreen("chat")} onOpenMe={() => setScreen("me")} />;

  return <KeyboardProvider><View style={styles.screen}>{content}</View></KeyboardProvider>;
}

async function preloadImages(images: Array<ReturnType<typeof require>>): Promise<void> {
  await Promise.all(images.map(async (image) => {
    const source = Image.resolveAssetSource(image);
    if (!source?.uri) return;
    try { await Image.prefetch(source.uri); } catch {}
  }));
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: "#FFFFFF" } });
