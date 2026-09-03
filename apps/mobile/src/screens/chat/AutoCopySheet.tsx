import React from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t } from "../../i18n";
import { theme } from "../../theme";

type AutoCopySheetProps = {
  visible: boolean;
  replyEnabled: boolean;
  onClose: () => void;
  onReplyEnabledChange: (enabled: boolean) => void;
};

export function AutoCopySheet({
  visible,
  replyEnabled,
  onClose,
  onReplyEnabledChange,
}: AutoCopySheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("chat.settings.title")}</Text>
            <Pressable style={styles.closeButton} hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={20} color="#111111" />
            </Pressable>
          </View>

          <Pressable
            style={styles.option}
            accessibilityRole="switch"
            accessibilityState={{ checked: replyEnabled }}
            onPress={() => onReplyEnabledChange(!replyEnabled)}
          >
            <Text style={styles.optionLabel}>{t("chat.settings.generate_reply")}</Text>
            <Switch
              pointerEvents="none"
              value={replyEnabled}
              trackColor={{ false: "#D8DDE7", true: theme.colors.accent }}
              thumbColor="#FFFFFF"
            />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.24)",
    justifyContent: "flex-end",
  },
  sheet: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "800",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F3F7",
    alignItems: "center",
    justifyContent: "center",
  },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionLabel: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "700",
  },
});
