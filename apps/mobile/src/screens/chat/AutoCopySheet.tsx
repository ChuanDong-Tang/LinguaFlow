import React from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatContact } from "../../domain/chat/contacts";
import type { CompanionMode } from "../../services/preferences/assistantPreferences";
import { t } from "../../i18n";

type AutoCopySheetProps = {
  visible: boolean;
  contact: ChatContact;
  autoClozeEnabled: boolean;
  companionMode: CompanionMode;
  onClose: () => void;
  onSetAutoClozeEnabled: (enabled: boolean) => void;
  onSelectCompanionMode: (mode: CompanionMode) => void;
};

export function AutoCopySheet({
  visible,
  contact,
  autoClozeEnabled,
  companionMode,
  onClose,
  onSetAutoClozeEnabled,
  onSelectCompanionMode,
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
                {COMPANION_MODE_OPTIONS.map((option) => {
                  const selected = companionMode === option.mode;
                  return (
                    <Pressable
                      key={option.mode}
                      style={[styles.option, selected && styles.optionSelected]}
                      onPress={() => onSelectCompanionMode(option.mode)}
                    >
                      <View style={styles.optionTextWrap}>
                        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{t(option.labelKey)}</Text>
                        <Text style={styles.optionDescription}>{t(option.descriptionKey)}</Text>
                      </View>
                      <View style={[styles.radio, selected && styles.radioSelected]}>
                        {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>{t("chat.autocloze.toggle")}</Text>
              <Text style={styles.toggleDescription}>
                {t("chat.autocloze.desc")}
              </Text>
            </View>
            <Switch
              value={autoClozeEnabled}
              onValueChange={onSetAutoClozeEnabled}
              trackColor={{ false: "#D5DAE4", true: "#C8C0FF" }}
              thumbColor={autoClozeEnabled ? "#8E7BFF" : "#FFFFFF"}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const COMPANION_MODE_OPTIONS: Array<{
  mode: CompanionMode;
  labelKey: Parameters<typeof t>[0];
  descriptionKey: Parameters<typeof t>[0];
}> = [
  { mode: "rewrite_only", labelKey: "chat.companion_mode.rewrite_only", descriptionKey: "chat.companion_mode.rewrite_only_desc" },
  { mode: "native_note", labelKey: "chat.companion_mode.native_note", descriptionKey: "chat.companion_mode.native_note_desc" },
  { mode: "simple_reply", labelKey: "chat.companion_mode.simple_reply", descriptionKey: "chat.companion_mode.simple_reply_desc" },
];

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
  toggleRow: {
    minHeight: 62,
    borderRadius: 12,
    backgroundColor: "#F7F8FB",
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
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
  toggleTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  toggleLabel: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "800",
  },
  toggleDescription: {
    marginTop: 3,
    color: "#838AA0",
    fontSize: 12,
    lineHeight: 16,
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
    borderColor: "#8E7BFF",
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
    color: "#5A47D8",
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
    borderColor: "#8E7BFF",
    backgroundColor: "#8E7BFF",
  },
  radioDisabled: {
    borderColor: "#D8DDE7",
    backgroundColor: "#EEF1F6",
  },
});
