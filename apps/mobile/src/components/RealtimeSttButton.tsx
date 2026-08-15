import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { RealtimeSttInputStatus } from "../hooks/useRealtimeSttInput";
import { theme } from "../theme";
import { t } from "../i18n";

export function RealtimeSttButton({ status, audioLevel = 0, disabled = false, onPress, style, iconSize = 21 }: {
  status: RealtimeSttInputStatus;
  audioLevel?: number;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
}) {
  const active = status !== "idle";
  const loading = status === "connecting" || status === "stopping";
  return <Pressable
    accessibilityLabel={status === "idle" ? t("stt.a11y.start") : status === "recording" ? t("stt.a11y.stop") : t("stt.a11y.preparing")}
    disabled={disabled || loading}
    hitSlop={6}
    style={[styles.button, style, active && styles.active, disabled && styles.disabled]}
    onPress={onPress}
  >
    {loading
      ? <ActivityIndicator size="small" color={theme.colors.danger} />
      : status === "recording"
        ? <View style={styles.waveform}>{[0.62, 1, 0.78, 0.52].map((weight, index) => <View key={index} style={[styles.waveformBar, { height: 4 + audioLevel * 17 * weight }]} />)}</View>
        : <Ionicons name="mic-outline" size={iconSize} color={theme.colors.textSecondary} />}
    {status === "recording" ? <View style={styles.recordingDot} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: "#FCEAE8" },
  disabled: { opacity: 0.42 },
  recordingDot: { position: "absolute", top: 4, right: 5, width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.danger },
  waveform: { height: 22, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  waveformBar: { width: 3, borderRadius: 2, backgroundColor: theme.colors.danger },
});
