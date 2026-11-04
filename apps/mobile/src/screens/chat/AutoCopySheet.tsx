import React from "react";
import { Modal, Pressable, StyleSheet, Switch, View } from "react-native";
import { Text } from "../../components/Typography";
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
              <Ionicons name="close" size={20} color={theme.colors.text} />
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
              trackColor={{ false: theme.colors.textFaint, true: theme.colors.accent }}
              thumbColor={theme.colors.surface}
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
    backgroundColor: theme.colors.surface,
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
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surfaceSunken,
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
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
});
