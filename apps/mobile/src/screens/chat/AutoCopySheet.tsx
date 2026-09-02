import React from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatContact } from "../../domain/chat/contacts";
import { t } from "../../i18n";
import { theme } from "../../theme";

type AutoCopySheetProps = {
  visible: boolean;
  contact: ChatContact;
  replyEnabled: boolean;
  onClose: () => void;
  onReplyEnabledChange: (enabled: boolean) => void;
};

export function AutoCopySheet({
  visible,
  contact,
  replyEnabled,
  onClose,
  onReplyEnabledChange,
}: AutoCopySheetProps) {
  const showCompanionMode = contact.capabilities?.companionMode === true;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{t("chat.settings.title")}</Text>
              <Text style={styles.subtitle}>{t("chat.settings.subtitle")}</Text>
            </View>
            <Pressable style={styles.closeButton} hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={20} color="#111111" />
            </Pressable>
          </View>

          {showCompanionMode ? (
            <View style={styles.modeSection}>
              <Text style={styles.sectionLabel}>{t("chat.settings.companion_mode")}</Text>
              <View style={styles.options}>
                <Pressable
                  style={styles.option}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: replyEnabled }}
                  onPress={() => onReplyEnabledChange(!replyEnabled)}
                >
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionLabel}>{t("chat.settings.generate_reply")}</Text>
                    <Text style={styles.optionDescription}>{t("chat.settings.generate_reply_desc")}</Text>
                  </View>
                  <Switch
                    pointerEvents="none"
                    value={replyEnabled}
                    trackColor={{ false: "#D8DDE7", true: theme.colors.accent }}
                    thumbColor="#FFFFFF"
                  />
                </Pressable>
              </View>
            </View>
          ) : null}

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
    paddingBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modeSection: {
    marginBottom: 12,
  },
  sectionLabel: {
    marginBottom: 8,
    color: "#606775",
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 4,
    color: "#838AA0",
    fontSize: 13,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F3F7",
    alignItems: "center",
    justifyContent: "center",
  },
  options: {
    gap: 8,
  },
  option: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E5EE",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  optionSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: "#F5F3FF",
  },
  optionDisabled: {
    borderColor: "#E5E8EF",
    backgroundColor: "#F6F7FA",
  },
  optionTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  optionLabel: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "800",
  },
  optionLabelSelected: {
    color: theme.colors.accentStrong,
  },
  optionDescription: {
    marginTop: 3,
    color: "#838AA0",
    fontSize: 12,
    lineHeight: 16,
  },
  optionTextDisabled: {
    color: "#A8AFBD",
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#C8CEDA",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: theme.colors.accentStrong,
    backgroundColor: theme.colors.accentStrong,
  },
  radioDisabled: {
    borderColor: "#D8DDE7",
    backgroundColor: "#EEF1F6",
  },
});
