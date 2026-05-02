import React, { useEffect, useState } from "react";
import { Animated, Image, StyleSheet } from "react-native";
import { SplashGateScreen } from "./screens/SplashGateScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { initI18n } from "./i18n";
import { clearSession, getSession } from "./services/authStorage";
import { HomeScreen } from "./screens/HomeScreen";
import { ChatScreen } from "./screens/ChatScreen";

type Screen = "splash" | "login" | "home" | "chat";

const PRELOAD_IMAGES = [
  require("../assets/splash/logo.png"),
];

export default function App() {  
  const [screen, setScreen] = useState<Screen>("splash");
  const [visibleScreen, setVisibleScreen] = useState<Screen>("splash");
  const [screenOpacity] = useState(() => new Animated.Value(1));

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
      await Promise.all([initI18n(), preloadImages(PRELOAD_IMAGES)]);
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

  useEffect(() => {
    if (screen === visibleScreen) return;

    Animated.timing(screenOpacity, {
      toValue: 0,
      duration: 240,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;

      setVisibleScreen(screen);
      Animated.timing(screenOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }).start();
    });
  }, [screen, screenOpacity, visibleScreen]);

  let content: React.ReactNode;

  if (visibleScreen === "splash") {
    content = <SplashGateScreen />;
  } else if (visibleScreen === "login") {
    // 登录成功后由 App 统一切到 home
    content = <LoginScreen onLoginSuccess={() => setScreen("home")} />;
  } else if (visibleScreen === "chat") {
    content = <ChatScreen onBack={() => setScreen("home")} />;
  } else {
    // Home 占位：加一个退出按钮，验证登录闭环
    content = (
      <HomeScreen
        onOpenChat={() => setScreen("chat")}
        onLogout={async () => {
          await clearSession();
          setScreen("login");
        }}
      />
    );
  }

  return (
    <Animated.View style={[styles.screen, { opacity: screenOpacity }]}>
      {content}
    </Animated.View>
  );

}

async function preloadImages(images: Array<ReturnType<typeof require>>): Promise<void> {
  await Promise.all(
    images.map(async (image) => {
      const source = Image.resolveAssetSource(image);
      if (!source?.uri) return;

      try {
        await Image.prefetch(source.uri);
      } catch {
        // 图片预热失败不应该阻断启动流程，Image 组件仍会正常加载本地资源。
      }
    })
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
});
