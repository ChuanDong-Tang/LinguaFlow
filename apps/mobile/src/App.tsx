import React, { useEffect, useState } from "react";
import { SplashGateScreen } from "./screens/SplashGateScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { initI18n } from "./i18n";
import { clearSession, getSession } from "./services/authStorage";
import { HomeScreen } from "./screens/HomeScreen";
import { ChatScreen } from "./screens/ChatScreen";

type Screen = "splash" | "login" | "home" | "chat";

export default function App() {
  const [screen, setScreen] = useState<Screen>("splash");

useEffect(() => {
  let mounted = true;

  // sleep
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function bootstrap() {
    // 记录启动流程开始时间
    const startAt = Date.now();
    const MIN_SPLASH_MS = 1000; // 启动页最短展示 600ms

    try {
      await initI18n();
      const session = await getSession();

      // 计算已耗时，不足最短时长就补齐等待
      const elapsed = Date.now() - startAt;
      const remain = MIN_SPLASH_MS - elapsed;
      if (remain > 0) {
        await sleep(remain);
      }

      if (!mounted) return;
      setScreen(session ? "home" : "login");
    } catch {
      // 出错也保持同样的启动节奏，避免忽快忽慢
      const elapsed = Date.now() - startAt;
      const remain = MIN_SPLASH_MS - elapsed;
      if (remain > 0) {
        await sleep(remain);
      }

      if (!mounted) return;
      setScreen("login");
    }
  }

  void bootstrap();

  return () => {
    mounted = false;
  };
}, []);

  if (screen === "splash") {
    return <SplashGateScreen />;
  }

  if (screen === "login") {
    // 登录成功后由 App 统一切到 home
    return <LoginScreen onLoginSuccess={() => setScreen("home")} />;
  }

  if (screen === "chat") {
    return <ChatScreen onBack={() => setScreen("home")} />;
  }

  // Home 占位：加一个退出按钮，验证登录闭环
  return (
    <HomeScreen
      onOpenChat={() => setScreen("chat")}
      onLogout={async () => {
        await clearSession();
        setScreen("login");
      }}
    />
  );

}
