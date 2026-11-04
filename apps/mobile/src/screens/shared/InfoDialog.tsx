import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../components/Typography";
import { t } from "../../i18n";
import { theme } from "../../theme";

export type InfoDialogConfig = {
  message: string;
  cancelText?: string;
  confirmText?: string;
  onCancel?: () => void;
  onConfirm?: () => void;
};

export function InfoDialog({ config, onClose }: { config: InfoDialogConfig | null; onClose: () => void }) {
  if (!config) return null;
  const hasCancel = !!config.cancelText;

  function closeThen(callback?: () => void): void {
    onClose();
    callback?.();
  }

  return (
    <View style={styles.backdrop}>
      <View style={styles.panel}>
        <Text style={styles.message}>{config.message}</Text>
        <View style={styles.actions}>
          {hasCancel ? (
            <Pressable style={[styles.button, styles.cancelButton]} onPress={() => closeThen(config.onCancel)}>
              <Text style={styles.cancelText}>{config.cancelText}</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.button, styles.confirmButton]} onPress={() => closeThen(config.onConfirm)}>
            <Text style={styles.confirmText}>{config.confirmText ?? t("common.confirm")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000,
    elevation: 1000,
    flex: 1,
    backgroundColor: "rgba(15,16,20,0.36)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  panel: {
    width: "100%",
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  message: {
    color: theme.colors.text,
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center",
  },
  actions: {
    marginTop: 22,
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  confirmButton: {
    backgroundColor: theme.colors.ink,
  },
  cancelText: {
    color: theme.colors.textStrong,
    fontSize: 15,
    fontWeight: "700",
  },
  confirmText: {
    color: theme.colors.onAccent,
    fontSize: 15,
    fontWeight: "700",
  },
});
