import React, { useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { videoEmbedUrl } from "@lf/core/text/videoLink";
import { Text } from "./Typography";
import { Icon } from "./Icon";
import { haptic } from "../feedback/haptics";
import { t } from "../i18n";
import { theme } from "../theme";
import { createStyles } from "../styles";

/**
 * Plays a memory's YouTube / Bilibili link inside OIO with the official embed
 * player (2026-11), so OIO can be a home for English videos. Falls back to the
 * provider's app or site when the embed can't play.
 */
export function VideoPlayerModal({ link, onClose }: {
  link: { url: string; provider: string; title: string | null } | null;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  if (!link) return null;
  const embed = videoEmbedUrl(link.url);
  const providerName = link.provider === "bilibili" ? "Bilibili" : "YouTube";
  const openOutside = () => { haptic.light(); void Linking.openURL(link.url).catch(() => undefined); };
  const playerHeight = Math.round(width * 9 / 16);
  return <Modal visible animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
    <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} style={styles.close} onPress={onClose}>
          <Icon name="close" size={24} color="#FFFFFF" />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>{link.title || providerName}</Text>
      </View>
      <View style={[styles.player, { height: playerHeight }]}>
        {embed && !failed ? <WebView
          source={{ uri: embed }}
          style={styles.web}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true); }}
          onHttpError={(event) => { if (event.nativeEvent.statusCode >= 400) { setLoading(false); setFailed(true); } }}
          // Stay on the player: anything else (logos, related videos) opens outside.
          onShouldStartLoadWithRequest={(request) => {
            const host = (() => { try { return new URL(request.url).hostname; } catch { return ""; } })();
            const allowed = /(^|\.)(youtube-nocookie\.com|youtube\.com|ytimg\.com|googlevideo\.com|bilibili\.com|hdslb\.com|bilivideo\.com|biliapi\.net)$/u.test(host) || request.url.startsWith("about:");
            if (!allowed) void Linking.openURL(request.url).catch(() => undefined);
            return allowed;
          }}
        /> : <View style={styles.fallback}>
          <Text style={styles.fallbackText}>{t("video.unavailable")}</Text>
        </View>}
        {loading && embed && !failed ? <ActivityIndicator style={styles.loader} color="#FFFFFF" /> : null}
      </View>
      <Pressable accessibilityRole="button" style={({ pressed }) => [styles.outside, pressed && { opacity: 0.75 }]} onPress={openOutside}>
        <Icon name="link-outline" size={16} color="#FFFFFF" />
        <Text style={styles.outsideText}>{t(link.provider === "bilibili" ? "video.open_bilibili" : "video.open_youtube")}</Text>
      </Pressable>
    </SafeAreaView>
  </Modal>;
}

// A dark stage regardless of appearance, like any video player.
const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: "#000000" },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  player: { width: "100%", marginTop: 40, backgroundColor: "#000000" },
  web: { flex: 1, backgroundColor: "#000000" },
  loader: { position: "absolute", alignSelf: "center", top: "45%" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  fallbackText: { color: "#BDBDBD", fontSize: 14, textAlign: "center" },
  outside: { marginTop: 28, alignSelf: "center", minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", gap: 6 },
  outsideText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
}));
