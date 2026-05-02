import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n";
import { login } from "../services/authApi";
import { setSession } from "../services/authStorage";
import { logEvent } from "../services/logger";

// 登录页对外暴露一个“登录成功回调”，由 App 决定跳转到哪里
type LoginScreenProps = {
  onLoginSuccess: () => void;
};

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");

  async function handleWechatLogin() {
    if (!agreed || loading) return;

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* 顶部 Logo 占位，后续可替换图片 */}
        <Text style={styles.logoText}>O</Text>

        {/* 微信登录按钮：未勾选协议时禁用 */}
        <Pressable
          style={[styles.wechatButton, (!agreed || loading) && styles.wechatButtonDisabled]}
          onPress={handleWechatLogin}
          disabled={!agreed || loading}
        >
          <Text style={styles.wechatIcon}>◎</Text>
          <Text style={styles.wechatText}>
            {loading ? "登录中..." : t("auth.login.wechat_button")}
          </Text>
        </Pressable>

        {/* 协议勾选 */}
        <Pressable style={styles.agreeRow} onPress={() => setAgreed((v) => !v)}>
          <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
            {agreed ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>

          <Text style={styles.agreeText}>
            {t("auth.login.agree_prefix")}{" "}
            <Text style={styles.linkText}>{t("auth.login.terms")}</Text>{" "}
            {t("auth.login.and")}{" "}
            <Text style={styles.linkText}>{t("auth.login.privacy")}</Text>
          </Text>
        </Pressable>

        {/* 状态提示 */}
        {!!statusText && <Text style={styles.statusText}>{statusText}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 120,
    alignItems: "center"
  },
  logoText: {
    fontSize: 72,
    fontWeight: "700",
    color: "#111111",
    letterSpacing: 2,
    marginBottom: 140
  },
  wechatButton: {
    width: "100%",
    height: 56,
    borderRadius: 18,
    backgroundColor: "#111111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center"
  },
  wechatButtonDisabled: { opacity: 0.45 },
  wechatIcon: {
    color: "#FFFFFF",
    fontSize: 18,
    marginRight: 10
  },
  wechatText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600"
  },
  agreeRow: {
    marginTop: 26,
    width: "100%",
    flexDirection: "row",
    alignItems: "center"
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderColor: "#8E8E93",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12
  },
  checkboxChecked: {
    backgroundColor: "#111111",
    borderColor: "#111111"
  },
  checkboxMark: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700"
  },
  agreeText: {
    flex: 1,
    color: "#5B5B61",
    fontSize: 16,
    lineHeight: 22
  },
  linkText: {
    color: "#111111",
    textDecorationLine: "underline"
  },
  statusText: {
    marginTop: 14,
    color: "#D14343",
    fontSize: 14
  }
});
