import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { t } from "../../i18n";

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
    ...StyleSheet.absoluteFillObject,
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
    backgroundColor: "#FFFFFF",
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  message: {
    color: "#151821",
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
    backgroundColor: "#F1F2F6",
  },
  confirmButton: {
    backgroundColor: "#111111",
  },
  cancelText: {
    color: "#4D5361",
    fontSize: 15,
    fontWeight: "700",
  },
  confirmText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
