import React, { useEffect, useRef, useState } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Animated, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n";
import { login, loginWithAuthing } from "../services/authApi";
import { getAuthingClientId, getAuthingDiscovery, getAuthingRedirectUri, isAuthingConfigured } from "../services/authingAuth";
import { clearForceAuthingLogin, setSession, shouldForceAuthingLogin } from "../services/authStorage";
import { logEvent } from "../services/logger";
import { getCurrentEntitlement } from "../services/meApi";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";
import type { User } from "@lf/core/types";
import Ionicons from "@expo/vector-icons/Ionicons";


WebBrowser.maybeCompleteAuthSession();

type LoginScreenProps = { onLoginSuccess: () => void };

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [forceAuthingLogin, setForceAuthingLogin] = useState(false);
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterTranslateY = useRef(new Animated.Value(14)).current;
  const agreementShake = useRef(new Animated.Value(0)).current;

  const authingConfigured = isAuthingConfigured();
  const authingDiscovery = authingConfigured ? getAuthingDiscovery() : null;
  const authingClientId = authingConfigured ? getAuthingClientId() : "authing-disabled";
  const authingRedirectUri = getAuthingRedirectUri();
  const [authingRequest, _authingResponse, promptAuthingAsync] = AuthSession.useAuthRequest(
    {
      clientId: authingClientId,
      redirectUri: authingRedirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "offline_access"],
      usePKCE: true,
      prompt: forceAuthingLogin ? AuthSession.Prompt.Login : undefined,
    },
    authingDiscovery
  );

  useEffect(() => {
    let mounted = true;
    void shouldForceAuthingLogin().then((value) => mounted && setForceAuthingLogin(value));
    Animated.parallel([
      Animated.timing(enterOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(enterTranslateY, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
    return () => { mounted = false; };
  }, [enterOpacity, enterTranslateY]);

  async function handlePrimaryLogin() {
    if (loading) return;
    if (!agreed) return shakeAgreement();
    setLoading(true);
    setStatusText("");
    try {
      if (authingConfigured) {
        if (!authingRequest || !authingDiscovery) { setStatusText("Authing 登录尚未准备好，请稍后重试"); return; }
        const result = await promptAuthingAsync();
        if (result.type !== "success") { setStatusText("已取消登录"); return; }
        const tokenResult = await AuthSession.exchangeCodeAsync({ clientId: authingClientId, code: result.params.code, redirectUri: authingRedirectUri, extraParams: { code_verifier: authingRequest.codeVerifier ?? "" } }, authingDiscovery);
        const backendSession = await loginWithAuthing({ authingToken: tokenResult.accessToken });
        const localSession = { accessToken: backendSession.accessToken, refreshToken: backendSession.refreshToken, user: toSessionUser(backendSession.user), sessionFlags: { isPro: false } };
        await setSession(localSession);
        const entitlement = await getCurrentEntitlement().catch(() => null);
        if (entitlement) await setSession({ ...localSession, sessionFlags: { isPro: entitlement.isPro } });
        await logEvent("authing_login_ui_success", "info", undefined, { userId: backendSession.user.id });
        await clearForceAuthingLogin();
        onLoginSuccess();
        return;
      }
      const result = await login({ type: "wechat_code", wechatCode: "mock_wechat_code" });
      const localSession = { accessToken: result.token, refreshToken: result.refreshToken, user: result.user, sessionFlags: { isPro: result.sessionFlags?.isPro ?? false } };
      await setSession(localSession);
      const entitlement = await getCurrentEntitlement().catch(() => null);
      if (entitlement) await setSession({ ...localSession, sessionFlags: { isPro: entitlement.isPro } });
      await logEvent("login_ui_success", "info", undefined, { userId: result.user.id });
      await clearForceAuthingLogin();
      onLoginSuccess();
    } catch (err) {
      const message = normalizeLoginError(err, t("auth.login.failed"));
      setStatusText(message);
      await logEvent("login_ui_failed", "warn", err instanceof Error ? err.message : message);
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

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: enterOpacity, transform: [{ translateY: enterTranslateY }] }]}>
        <Image source={require("../../assets/app/logo.png")} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.brandText}>OIO</Text>
        <Text style={styles.tagline}>Output  ·  Input  ·  Output</Text>

        <Pressable style={[styles.loginButton, (!agreed || loading) && styles.loginButtonDisabled]} onPress={handlePrimaryLogin} disabled={loading}>
          <Text style={styles.loginText}>{loading ? "登录中..." : "登录"}</Text>
        </Pressable>

        <Animated.View style={[styles.agreementBlock, { transform: [{ translateX: agreementShake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) }] }]}>
          <View style={styles.agreeRow}>
            <Pressable style={[styles.checkbox, agreed && styles.checkboxChecked]} onPress={() => setAgreed((v) => !v)}>
              {agreed ? <Ionicons name="checkmark" size={20} color="#111111" /> : null}
            </Pressable>
            <Text style={styles.agreeText}>{t("auth.login.agree_prefix")} <Text style={styles.linkText} onPress={() => void Linking.openURL(TERMS_URL)}>{t("auth.login.terms")}</Text> {t("auth.login.and")} <Text style={styles.linkText} onPress={() => void Linking.openURL(PRIVACY_URL)}>{t("auth.login.privacy")}</Text></Text>
          </View>
          {!!statusText && <Text style={styles.statusText}>{statusText}</Text>}
        </Animated.View>
      </Animated.View>
    </SafeAreaView>
  );
}

function normalizeLoginError(error: unknown, fallback: string): string { const message = error instanceof Error ? error.message : fallback; if (message.includes("invalid input value for enum")) return "登录服务配置正在更新，请稍后重试"; if (message.length > 90) return "登录失败，请稍后重试"; return message || fallback; }
function toSessionUser(user: { id: string; nickname: string | null; avatarUrl: string | null; createdAt: Date; updatedAt: Date; }): User { return { id: user.id, phone: null, email: null, wechatOpenId: null, displayName: user.nickname, avatarUrl: user.avatarUrl, createdAt: new Date(user.createdAt).toISOString(), updatedAt: new Date(user.updatedAt).toISOString() }; }

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FCFCFD" },
  content: { flex: 1, paddingHorizontal: 32, paddingTop: 132, alignItems: "center" },
  logoImage: {
    width: 180,
    height: 180,
    marginTop: 40,
  },
  brandText: { marginTop: -30, fontSize: 20, fontWeight: "500", color: "#050505", letterSpacing: 1 },
  tagline: { marginTop: 8, color: "#6E7280", fontSize: 14, letterSpacing: 0.2 },
  loginButton: { marginTop: 80, width: "100%", maxWidth: 340, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: "#20222A", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  loginButtonDisabled: { opacity: 0.56 },
  loginText: { color: "#111111", fontSize: 18, fontWeight: "500" },
  agreementBlock: { marginTop: 36, width: "100%", maxWidth: 340, alignItems: "center" },
  agreeRow: { width: "100%", maxWidth: 320, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  checkbox: { width: 24, height: 24, borderWidth: 1.2, borderColor: "#6F7078", borderRadius: 6, marginRight: 10, backgroundColor: "#FFFFFF" },
  checkboxChecked: { backgroundColor: "#FFFFFF", borderColor: "#111111" },
  agreeText: { flexShrink: 1, color: "#545A68", fontSize: 14, lineHeight: 21 },
  linkText: { color: "#111111", textDecorationLine: "underline" },
  statusText: { marginTop: 10, color: "#D14343", fontSize: 12, textAlign: "center" },
});
