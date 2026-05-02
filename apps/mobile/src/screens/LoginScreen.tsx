import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, Linking, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Svg, { Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n";
import { login } from "../services/authApi";
import { setSession } from "../services/authStorage";
import { logEvent } from "../services/logger";

// 登录页对外暴露一个“登录成功回调”，由 App 决定跳转到哪里
type LoginScreenProps = {
  onLoginSuccess: () => void;
};

const TERMS_URL = "https://example.com/terms";
const PRIVACY_URL = "https://example.com/privacy";

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterTranslateY = useRef(new Animated.Value(14)).current;
  const agreementShake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(enterTranslateY, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }),
    ]).start();
  }, [enterOpacity, enterTranslateY]);

  async function handleWechatLogin() {
    if (loading) return;
    if (!agreed) {
      shakeAgreement();
      return;
    }

    setLoading(true);
    setStatusText("");

    try {
      // 先用 mock 请求体跑通流程；后续接真微信时替换 wechatCode 来源
      const result = await login({
        type: "wechat_code",
        wechatCode: "mock_wechat_code"
      });

      // 保存本地会话，供 App 启动自动登录读取
      await setSession({
        token: result.token,
        user: result.user,
        sessionFlags: result.sessionFlags,
      });

      await logEvent("login_ui_success", "info", undefined, { userId: result.user.id });
      onLoginSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("auth.login.failed");
      setStatusText(message);
      await logEvent("login_ui_failed", "warn", message);
    } finally {
      setLoading(false);
    }
  }

  function shakeAgreement() {
    agreementShake.setValue(0);
    Animated.sequence([
      Animated.timing(agreementShake, { toValue: 1, duration: 58, useNativeDriver: true }),
      Animated.timing(agreementShake, { toValue: -1, duration: 58, useNativeDriver: true }),
      Animated.timing(agreementShake, { toValue: 0.75, duration: 58, useNativeDriver: true }),
      Animated.timing(agreementShake, { toValue: -0.5, duration: 58, useNativeDriver: true }),
      Animated.timing(agreementShake, { toValue: 0, duration: 58, useNativeDriver: true }),
    ]).start();
  }

  function openLegalUrl(url: string) {
    void Linking.openURL(url);
  }

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: enterOpacity,
            transform: [{ translateY: enterTranslateY }],
          },
        ]}
      >
        <View style={styles.doodleLayer} pointerEvents="none">
          <SketchHeart style={styles.doodleHeart} />
        </View>

        <Image
          source={require("../../assets/splash/logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />

        <Text style={styles.brandText}>OIO</Text>
        <View style={styles.taglineWrap}>
          <Text style={styles.tagline}>把中文想法，说成自然英文</Text>
        </View>

        {/* 微信登录按钮：未勾选协议时禁用 */}
        <Pressable
          style={[styles.wechatButton, (!agreed || loading) && styles.wechatButtonDisabled]}
          onPress={handleWechatLogin}
          disabled={loading}
        >
          <SketchButtonFrame />
          <View style={styles.wechatIcon}>
            <Ionicons name="logo-wechat" size={24} color="white" />
          </View>
          <Text style={styles.wechatText}>
            {loading ? "登录中..." : t("auth.login.wechat_button")}
          </Text>
        </Pressable>

        {/* 协议勾选 */}
        <Animated.View
          style={[
            styles.agreementBlock,
            {
              transform: [
                {
                  translateX: agreementShake.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-8, 8],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.agreeRow}>
            <Pressable
              style={styles.checkboxPressable}
              hitSlop={10}
              onPress={() => setAgreed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
            >
              <SketchCheckbox checked={agreed} />
            </Pressable>

            <Text style={styles.agreeText}>
              {t("auth.login.agree_prefix")}{" "}
              <Text style={styles.linkText} onPress={() => openLegalUrl(TERMS_URL)}>
                {t("auth.login.terms")}
              </Text>{" "}
              {t("auth.login.and")}{" "}
              <Text style={styles.linkText} onPress={() => openLegalUrl(PRIVACY_URL)}>
                {t("auth.login.privacy")}
              </Text>
            </Text>
          </View>

          {/* 状态提示 */}
          {!!statusText && <Text style={styles.statusText}>{statusText}</Text>}
        </Animated.View>
      </Animated.View>
    </SafeAreaView>
  );
}

function SketchHeart({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Svg width="100%" height="100%" viewBox="0 0 36 34">
        <Path
          d="M17.6 29.5c-1.5-1.1-2.8-2.1-4.2-3.4-3.3-3-7-6.8-7-11.4 0-3.8 2.8-6.9 6.4-6.9 2.4 0 4.6 1.2 5.9 3.1 1.2-2 3.5-3.2 6-3.2 3.5 0 6.2 3 6.2 6.8 0 4.8-3.5 8.6-6.8 11.5-1.3 1.2-2.6 2.2-4.1 3.5l-.7.6-.7-.6Z"
          fill="none"
          stroke="#A59DF8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function SketchButtonFrame() {
  return (
    <View style={styles.wechatButtonFrame} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 342 78" preserveAspectRatio="none">
        <Path
          d="M22 5.5C88 2.8 179 5.4 320 4.5c11.8-.1 18 7.4 17.1 20.2-.7 9.4-.4 18.6.1 28 .5 11.6-6.8 18.6-18.7 18.9-86.3 2.2-192.6 1.2-296 .8C10.6 72.3 4.4 65.1 4.8 53.1c.4-9.7.5-19.5-.2-29.3C3.9 12.1 10.3 6 22 5.5Z"
          fill="none"
          stroke="rgba(255,255,255,0.34)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M19.5 9.3c55-3 152.5-1.1 303.3-1.9 9.1 0 14.4 5.2 14.2 14.6-.4 12.5-.2 23.2.4 33.5.5 8.7-5.2 14.3-14.3 14.7-92.5 3.8-204.8.2-302.6.1-8.9 0-14.1-5.6-14.2-14.2-.1-9.9.1-21.1-.3-33.7C5.7 14 10.8 9.8 19.5 9.3Z"
          fill="none"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function SketchCheckbox({ checked }: { checked: boolean }) {
  return (
    <View style={styles.checkboxShell}>
      <Svg width="100%" height="100%" viewBox="0 0 24 24">
        <Path
          d="M5 6.2c0-1.2.9-2.1 2.1-2.1h9.7c1.2 0 2.2.9 2.2 2.1v11.6c0 1.2-1 2.1-2.2 2.1H7.1C5.9 19.9 5 19 5 17.8Z"
          fill={checked ? "#111111" : "white"}
          stroke="#6F7078"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {checked ? (
          <Path
            d="M8 12.4l2.4 2.4 5-5.4"
            stroke="#FFFFFF"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  logoImage: {
    position: 'absolute',
    top: 0,
    width: 330,
    height: 330,
  },
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  content: {
    flex: 1,
    paddingHorizontal: 34,
    paddingTop: 194,
    alignItems: "center",
  },
  doodleLayer: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  },
  markWrap: {
    width: 210,
    height: 214,
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
    width: 126,
    height: 142,
    borderRadius: 62,
    backgroundColor: "rgba(145, 135, 255, 0.18)",
    transform: [{ rotate: "8deg" }],
  },
  sketchOuter: {
    width: 118,
    height: 138,
    borderRadius: 58,
    borderWidth: 8,
    borderColor: "#050505",
    transform: [{ rotate: "10deg" }],
  },
  sketchInner: {
    position: "absolute",
    width: 102,
    height: 126,
    borderRadius: 52,
    borderWidth: 5,
    borderColor: "#050505",
    transform: [{ rotate: "-4deg" }],
  },
  markAccentOne: {
    position: "absolute",
    right: 28,
    top: 26,
    width: 9,
    height: 34,
    borderRadius: 999,
    backgroundColor: "#948DF5",
    transform: [{ rotate: "15deg" }],
  },
  markAccentTwo: {
    position: "absolute",
    right: 2,
    top: 44,
    width: 9,
    height: 38,
    borderRadius: 999,
    backgroundColor: "#948DF5",
    transform: [{ rotate: "49deg" }],
  },
  markShadow: {
    position: "absolute",
    bottom: 10,
    width: 142,
    height: 18,
    borderRadius: 999,
    backgroundColor: "rgba(145, 135, 255, 0.16)",
  },
  brandText: {
    marginTop: 100,
    fontSize: 43,
    fontWeight: "700",
    color: "#050505",
    letterSpacing: 3,
  },
  taglineWrap: {
    marginTop: 8,
    alignItems: "center",
  },
  tagline: {
    color: "#8D9097",
    fontSize: 17,
    letterSpacing: 1.8,
  },
  taglineUnderline: {
    marginTop: 5,
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#A59DF8",
  },
  wechatButton: {
    marginTop: 78,
    width: "100%",
    maxWidth: 342,
    height: 78,
    borderRadius: 22,
    backgroundColor: "#111111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    shadowColor: "#8F86FF",
    shadowOpacity: 0.24,
    shadowRadius: 13,
    shadowOffset: { width: 0, height: 9 },
    elevation: 4,
  },
  wechatButtonDisabled: { opacity: 0.58 },
  wechatButtonFrame: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  },
  wechatIcon: {
    width: 28,
    height: 28,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  wechatBubbleLarge: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 32,
    height: 27,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  wechatBubbleSmall: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 30,
    height: 25,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  wechatEyeLeft: {
    position: "absolute",
    left: 9,
    top: 9,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#111111",
  },
  wechatEyeRight: {
    position: "absolute",
    right: 9,
    top: 9,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#111111",
  },
  wechatEyeSmallLeft: {
    position: "absolute",
    left: 8,
    top: 8,
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: "#111111",
  },
  wechatEyeSmallRight: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: "#111111",
  },
  wechatText: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: 1,
  },
  agreeRow: {
    width: "100%",
    maxWidth: 342,
    flexDirection: "row",
    alignItems: "center",
  },
  agreementBlock: {
    position: "absolute",
    left: 34,
    right: 34,
    bottom: 88,
    alignItems: "center",
  },
  checkboxPressable: {
    width: 32,
    height: 32,
    alignItems: "flex-start",
    justifyContent: "center",
    marginRight: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderColor: "#8E8E93",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  checkboxShell: {
    width: 24,
    height: 24,
  },
  checkboxChecked: {
    backgroundColor: "#111111",
    borderColor: "#111111",
  },
  checkboxMark: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  agreeText: {
    flex: 1,
    color: "#777A82",
    fontSize: 17,
    lineHeight: 24,
  },
  linkText: {
    color: "#111111",
    textDecorationLine: "underline",
  },
  statusText: {
    marginTop: 14,
    color: "#D14343",
    fontSize: 14,
  },
  doodleHeart: {
    position: "absolute",
    left: 70,
    top: 414,
    width: 36,
    height: 34,
    transform: [{ rotate: "-20deg" }],
  },
  heartLoopLeft: {
    position: "absolute",
    left: 3,
    top: 7,
    width: 18,
    height: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 3,
    borderColor: "#A59DF8",
    borderBottomWidth: 0,
    transform: [{ rotate: "-45deg" }],
  },
  heartLoopRight: {
    position: "absolute",
    right: 3,
    top: 7,
    width: 18,
    height: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 3,
    borderColor: "#A59DF8",
    borderBottomWidth: 0,
    transform: [{ rotate: "45deg" }],
  },
  doodleSparkTop: {
    position: "absolute",
    right: 112,
    top: 208,
    width: 44,
    height: 44,
  },
  sparkStrokeOne: {
    position: "absolute",
    left: 10,
    top: 2,
    width: 9,
    height: 34,
    borderRadius: 999,
    backgroundColor: "#948DF5",
    transform: [{ rotate: "15deg" }],
  },
  sparkStrokeTwo: {
    position: "absolute",
    right: 4,
    bottom: 2,
    width: 9,
    height: 34,
    borderRadius: 999,
    backgroundColor: "#948DF5",
    transform: [{ rotate: "50deg" }],
  },
  doodleSparkMid: {
    position: "absolute",
    right: 54,
    top: 586,
    width: 48,
    height: 42,
  },
  sparkStrokeThree: {
    position: "absolute",
    left: 0,
    top: 4,
    width: 6,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#A59DF8",
    transform: [{ rotate: "19deg" }],
  },
  sparkStrokeFour: {
    position: "absolute",
    left: 15,
    top: 13,
    width: 6,
    height: 27,
    borderRadius: 999,
    backgroundColor: "#A59DF8",
    transform: [{ rotate: "65deg" }],
  },
  sparkStrokeFive: {
    position: "absolute",
    right: 6,
    top: 19,
    width: 6,
    height: 25,
    borderRadius: 999,
    backgroundColor: "#A59DF8",
    transform: [{ rotate: "69deg" }],
  },
  doodleWave: {
    position: "absolute",
    right: 104,
    bottom: 118,
    width: 108,
    height: 22,
    flexDirection: "row",
    alignItems: "center",
  },
  waveSegmentOne: {
    width: 38,
    height: 8,
    borderTopWidth: 3,
    borderColor: "#A59DF8",
    borderRadius: 18,
    transform: [{ rotate: "-9deg" }],
  },
  waveSegmentTwo: {
    marginLeft: -5,
    width: 42,
    height: 9,
    borderTopWidth: 3,
    borderColor: "#A59DF8",
    borderRadius: 18,
    transform: [{ rotate: "7deg" }],
  },
  waveSegmentThree: {
    marginLeft: -4,
    width: 36,
    height: 8,
    borderTopWidth: 3,
    borderColor: "#A59DF8",
    borderRadius: 18,
    transform: [{ rotate: "-5deg" }],
  },
});
