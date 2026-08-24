import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t, tf } from "../i18n";
import {
  ApiError,
  loginWithAuthingPasscode,
  loginWithAuthingPassword,
  sendAuthingPasscode,
} from "../services/api/authApi";
import { clearForceAuthingLogin, setAuthingAccessToken, setSession } from "../services/auth/authStorage";
import { clearAccountScopedStorage } from "../services/auth/accountScopedStorage";
import { logEvent } from "../services/logger";
import { refreshEntitlementAndSessionSafe } from "../services/entitlement/entitlementSync";
import { PRIVACY_URL, TERMS_URL } from "../constants/legalUrls";
import type { User } from "@lf/core/types";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMountedGuard } from "../hooks/useMountedGuard";

type LoginScreenProps = { onLoginSuccess: () => void };
type LoginMode = "phone" | "email";
type LoginMethod = "passcode" | "password";

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { isMounted } = useMountedGuard();
  const [agreed, setAgreed] = useState(false);
  const [method, setMethod] = useState<LoginMethod>("passcode");
  const [mode, setMode] = useState<LoginMode>("email");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [passCode, setPassCode] = useState("");
  const [passwordAccount, setPasswordAccount] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [credentialError, setCredentialError] = useState("");
  const [agreementRequired, setAgreementRequired] = useState(false);
  const agreementShake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  function switchMode(nextMode: LoginMode) {
    if (loading || sendingCode || nextMode === mode) return;
    setMode(nextMode);
    setPassCode("");
    setCountdown(0);
    setStatusText("");
    setCredentialError("");
  }

  function switchMethod(nextMethod: LoginMethod) {
    if (loading || sendingCode || nextMethod === method) return;
    setMethod(nextMethod);
    setStatusText("");
    setCredentialError("");
    setPasswordVisible(false);
  }

  function buildCredential() {
    if (mode === "phone") {
      const normalizedPhone = phone.replace(/\D/g, "");
      if (!/^1\d{10}$/.test(normalizedPhone)) throw new Error(t("auth.login.invalid_phone"));
      return { channel: "phone" as const, phone: normalizedPhone, phoneCountryCode: "+86" };
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error(t("auth.login.invalid_email"));
    }
    return { channel: "email" as const, email: normalizedEmail };
  }

  async function handleSendCode() {
    if (sendingCode || countdown > 0) return;
    let credential: ReturnType<typeof buildCredential>;
    try {
      credential = buildCredential();
      setCredentialError("");
    } catch (error) {
      setCredentialError(error instanceof Error ? error.message : t("auth.login.send_failed"));
      return;
    }
    if (!agreed) return shakeAgreement();
    setSendingCode(true);
    setStatusText("");
    try {
      await sendAuthingPasscode(credential);
      if (!isMounted()) return;
      setCountdown(60);
    } catch (error) {
      if (!isMounted()) return;
      setStatusText(resolveLoginError(error, "send"));
      await logEvent("authing_passcode_send_failed", "warn", error instanceof Error ? error.message : String(error), {
        channel: mode,
      });
    } finally {
      if (isMounted()) setSendingCode(false);
    }
  }

  async function handlePrimaryLogin() {
    if (loading) return;
    if (!agreed) return shakeAgreement();
    setLoading(true);
    setStatusText("");
    try {
      await clearAccountScopedStorage();
      const result = method === "password"
        ? await loginWithAuthingPassword({
            account: requirePasswordAccount(passwordAccount),
            password: requirePassword(password),
          })
        : await loginWithAuthingPasscode({
            ...buildCredential(),
            passCode: requirePassCode(passCode),
          });
      const localSession = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: toSessionUser(result.user),
        sessionFlags: { isPro: false },
      };
      await setSession(localSession);
      await setAuthingAccessToken(result.authingToken);
      await refreshEntitlementAndSessionSafe();
      await logEvent("authing_login_success", "info", undefined, {
        userId: result.user.id,
        method,
        ...(method === "passcode" ? { channel: mode } : {}),
      });
      await clearForceAuthingLogin();
      if (!isMounted()) return;
      onLoginSuccess();
    } catch (err) {
      if (!isMounted()) return;
      const rawMessage = err instanceof Error ? err.message : String(err);
      setStatusText(resolveLoginError(err, "login"));
      await logEvent("authing_login_failed", "warn", rawMessage || t("auth.login.failed"), {
        method,
        ...(method === "passcode" ? { channel: mode } : {}),
      });
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  function shakeAgreement() {
    setAgreementRequired(true);
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
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <View style={styles.content}>
        <Image source={require("../../assets/app/logo.png")} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.brandText}>OIO</Text>

        {method === "passcode" ? (
          <View style={styles.modeTabs}>
            <Pressable style={[styles.modeTab, mode === "email" && styles.modeTabActive]} onPress={() => switchMode("email")}>
              <Text style={[styles.modeTabText, mode === "email" && styles.modeTabTextActive]}>{t("auth.login.email_tab")}</Text>
            </Pressable>
            <Pressable style={[styles.modeTab, mode === "phone" && styles.modeTabActive]} onPress={() => switchMode("phone")}>
              <Text style={[styles.modeTabText, mode === "phone" && styles.modeTabTextActive]}>{t("auth.login.phone_tab")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.passwordHeader}>
            <Text style={styles.passwordHeaderText}>{t("auth.login.password_title")}</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.inputShell}>
            {method === "passcode" && mode === "phone" ? <Text style={styles.countryCode}>+86</Text> : null}
            {method === "password" ? (
              <TextInput
                value={passwordAccount}
                onChangeText={setPasswordAccount}
                placeholder={t("auth.login.account_placeholder")}
                placeholderTextColor="#A1A4AD"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                style={styles.accountInput}
                maxLength={160}
              />
            ) : (
              <TextInput
                value={mode === "phone" ? phone : email}
                onChangeText={mode === "phone"
                  ? (value) => {
                      setPhone(value.replace(/\D/g, ""));
                      if (credentialError) setCredentialError("");
                    }
                  : (value) => {
                      setEmail(value);
                      if (credentialError) setCredentialError("");
                    }}
                placeholder={mode === "phone" ? t("auth.login.phone_placeholder") : t("auth.login.email_placeholder")}
                placeholderTextColor="#A1A4AD"
                keyboardType={mode === "phone" ? "phone-pad" : "email-address"}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType={mode === "phone" ? "telephoneNumber" : "emailAddress"}
                style={styles.accountInput}
                maxLength={mode === "phone" ? 11 : 120}
              />
            )}
          </View>
          {method === "passcode" && mode === "phone" ? <Text style={styles.phoneRegionHint}>{t("auth.login.phone_region_hint")}</Text> : null}
          {credentialError ? <Text style={styles.fieldErrorText}>{credentialError}</Text> : null}
          <View style={styles.inputShell}>
            {method === "password" ? (
              <>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t("auth.login.password_placeholder")}
                  placeholderTextColor="#A1A4AD"
                  secureTextEntry={!passwordVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  style={styles.accountInput}
                  maxLength={256}
                />
                <Pressable
                  style={styles.passwordVisibilityButton}
                  onPress={() => setPasswordVisible((value) => !value)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? t("auth.login.hide_password") : t("auth.login.show_password")}
                >
                  <Ionicons name={passwordVisible ? "eye-off-outline" : "eye-outline"} size={21} color="#777B85" />
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={passCode}
                  onChangeText={(value) => setPassCode(value.replace(/\D/g, ""))}
                  placeholder={t("auth.login.code_placeholder")}
                  placeholderTextColor="#A1A4AD"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  style={styles.accountInput}
                  maxLength={8}
                />
                <Pressable
                  style={styles.sendCodeButton}
                  onPress={handleSendCode}
                  disabled={sendingCode || countdown > 0}
                >
                  {sendingCode ? (
                    <ActivityIndicator size="small" color="#111111" />
                  ) : (
                    <Text style={[styles.sendCodeText, countdown > 0 && styles.sendCodeTextDisabled]}>
                      {countdown > 0 ? tf("auth.login.resend_countdown", { seconds: countdown }) : t("auth.login.send_code")}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </View>

        <Animated.View
          style={[
            styles.agreementBlock,
            agreementRequired && styles.agreementBlockRequired,
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
              style={styles.checkboxTouchTarget}
              onPress={() => {
                const next = !agreed;
                setAgreed(next);
                if (next) setAgreementRequired(false);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel={t("auth.login.agreement_checkbox")}
            >
              <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                {agreed ? <Ionicons name="checkmark" size={18} color="#111111" /> : null}
              </View>
            </Pressable>
            <Text style={styles.agreeText}>
              {t("auth.login.agree_prefix")}{" "}
              <Text style={styles.linkText} onPress={() => void Linking.openURL(TERMS_URL)}>
                {t("auth.login.terms")}
              </Text>{" "}
              {t("auth.login.and")}{" "}
              <Text style={styles.linkText} onPress={() => void Linking.openURL(PRIVACY_URL)}>
                {t("auth.login.privacy")}
              </Text>
            </Text>
          </View>
          {agreementRequired ? (
            <Text style={styles.agreementRequiredText}>{t("auth.login.agreement_required")}</Text>
          ) : null}
        </Animated.View>

        <Pressable
          style={[styles.loginButton, (!agreed || loading) && styles.loginButtonDisabled]}
          onPress={handlePrimaryLogin}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loginText}>{t("auth.login.button")}</Text>}
        </Pressable>

        <Pressable
          style={styles.methodSwitchButton}
          onPress={() => switchMethod(method === "passcode" ? "password" : "passcode")}
          disabled={loading || sendingCode}
        >
          <Text style={styles.methodSwitchText}>
            {method === "passcode" ? t("auth.login.use_password") : t("auth.login.use_passcode")}
          </Text>
        </Pressable>

        {!!statusText && <Text style={styles.statusText}>{statusText}</Text>}
      </View>
      </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

function resolveLoginError(error: unknown, action: "send" | "login"): string {
  if (error instanceof ApiError) {
    if (error.code === "RATE_LIMITED") return t("auth.login.too_frequent");
    if (error.code === "PASSCODE_INVALID") return t("auth.login.code_invalid");
    if (error.code === "PASSCODE_SEND_FAILED") return t("auth.login.send_failed");
    if (error.code === "PASSWORD_INVALID") return t("auth.login.password_invalid");
    return action === "send" ? t("auth.login.send_failed") : t("auth.login.failed");
  }
  if (error instanceof TypeError) return t("auth.login.network_failed");
  if (error instanceof Error && error.message) return error.message.slice(0, 120);
  return action === "send" ? t("auth.login.send_failed") : t("auth.login.failed");
}

function requirePassCode(value: string): string {
  const normalized = value.trim();
  if (!/^\d{4,8}$/.test(normalized)) throw new Error(t("auth.login.invalid_code"));
  return normalized;
}

function requirePasswordAccount(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(t("auth.login.account_required"));
  return normalized;
}

function requirePassword(value: string): string {
  if (!value) throw new Error(t("auth.login.password_required"));
  return value;
}

function toSessionUser(user: {
  id: string;
  username?: string | null;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role?: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
}): User {
  // Authing 返回字段和本地 User 类型不同，在写入会话前统一成 App 内部结构。
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    wechatOpenId: null,
    displayName: resolveDisplayName(user),
    avatarUrl: user.avatarUrl,
    role: user.role ?? "user",
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: new Date(user.updatedAt).toISOString(),
  };
}

function resolveDisplayName(user: {
  nickname: string | null;
  username?: string | null;
  email: string | null;
  phone: string | null;
}): string | null {
  return user.nickname?.trim() || user.username?.trim() || user.email?.trim() || user.phone?.trim() || null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  keyboardArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    paddingTop: 54,
    alignItems: "center",
  },

  logoImage: {
    width: 132,
    height: 132,
    marginTop: 16,
  },
  brandText: {
    marginTop: -22,
    color: "#050505",
    fontSize: 20,
    fontWeight: "500",
    letterSpacing: 1,
  },
  modeTabs: {
    marginTop: 48,
    width: "100%",
    maxWidth: 340,
    height: 44,
    padding: 3,
    borderRadius: 12,
    backgroundColor: "#F0F0F2",
    flexDirection: "row",
  },
  modeTab: {
    flex: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTabActive: {
    backgroundColor: "#FFFFFF",
  },
  modeTabText: {
    color: "#8A8D96",
    fontSize: 15,
  },
  modeTabTextActive: {
    color: "#111111",
    fontWeight: "600",
  },
  passwordHeader: {
    marginTop: 48,
    width: "100%",
    maxWidth: 340,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F0F0F2",
    alignItems: "center",
    justifyContent: "center",
  },
  passwordHeaderText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "600",
  },
  form: {
    marginTop: 18,
    width: "100%",
    maxWidth: 340,
    gap: 12,
  },
  inputShell: {
    height: 54,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DADCE2",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  phoneRegionHint: {
    marginTop: -5,
    paddingHorizontal: 2,
    color: "#8A8D96",
    fontSize: 12,
    lineHeight: 18,
  },
  countryCode: {
    paddingRight: 12,
    marginRight: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#DADCE2",
    color: "#111111",
    fontSize: 16,
    lineHeight: 20,
    includeFontPadding: false,
  },
  accountInput: {
    flex: 1,
    height: "100%",
    color: "#111111",
    fontSize: 16,
    lineHeight: 20,
    paddingVertical: 0,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  sendCodeButton: {
    minWidth: 78,
    height: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sendCodeText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "500",
  },
  sendCodeTextDisabled: {
    color: "#A1A4AD",
  },
  passwordVisibilityButton: {
    width: 38,
    height: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  fieldErrorText: {
    marginTop: -6,
    paddingHorizontal: 4,
    color: "#C53C3C",
    fontSize: 12,
    lineHeight: 18,
  },

  loginButton: {
    marginTop: 20,
    width: "100%",
    maxWidth: 340,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  loginButtonDisabled: {
    opacity: 0.56,
  },
  loginText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "500",
  },
  methodSwitchButton: {
    height: 34,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  methodSwitchText: {
    color: "#686C75",
    fontSize: 14,
  },

  agreementBlock: {
    marginTop: 12,
    width: "100%",
    maxWidth: 340,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 10,
    alignItems: "center",
  },
  agreementBlockRequired: {
    borderColor: "#E8B1B1",
    backgroundColor: "#FFF7F7",
  },
  agreeRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
  },
  checkboxTouchTarget: {
    width: 36,
    height: 36,
    marginRight: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.2,
    borderColor: "#6F7078",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    borderColor: "#111111",
    backgroundColor: "#FFFFFF",
  },
  agreeText: {
    flexShrink: 1,
    color: "#545A68",
    fontSize: 14,
    lineHeight: 21,
  },
  linkText: {
    color: "#111111",
    textDecorationLine: "underline",
  },
  agreementRequiredText: {
    width: "100%",
    paddingLeft: 40,
    color: "#C53C3C",
    fontSize: 12,
    lineHeight: 18,
  },
  statusText: {
    width: "100%",
    maxWidth: 340,
    marginTop: 8,
    color: "#D14343",
    fontSize: 12,
    textAlign: "center",
  },
});
