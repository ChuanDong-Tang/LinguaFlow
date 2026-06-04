import React from "react";
import { Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatContact } from "../../domain/chat/contacts";
import type { AutoCopyMode } from "../../services/preferences/assistantPreferences";

type AutoCopySheetProps = {
  visible: boolean;
  contact: ChatContact;
  autoCopyEnabled: boolean;
  selectedMode: AutoCopyMode;
  onClose: () => void;
  onSetAutoCopyEnabled: (enabled: boolean) => void;
  onSelectMode: (mode: AutoCopyMode) => void;
};

type AutoCopyOption = {
  mode: AutoCopyMode;
  label: string;
  description: string;
};

function getAutoCopyOptions(contact: ChatContact): AutoCopyOption[] {
  if (contact.id === "english_friend") {
    return [
      { mode: "en", label: "复制问题", description: "自动复制改写后的用户问题" },
      { mode: "zh", label: "复制回复", description: "自动复制 AI 的英文回复" },
      { mode: "both", label: "两个都复制", description: "问题和回复一起复制" },
    ];
  }

  return [
    { mode: "en", label: "复制英文", description: "自动复制英文改写" },
    { mode: "zh", label: "复制中文", description: "自动复制中文解释" },
    { mode: "both", label: "两个都复制", description: "英文和中文一起复制" },
  ];
}

export function AutoCopySheet({
  visible,
  contact,
  autoCopyEnabled,
  selectedMode,
  onClose,
  onSetAutoCopyEnabled,
  onSelectMode,
}: AutoCopySheetProps) {
  const options = getAutoCopyOptions(contact);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>自动复制</Text>
              <Text style={styles.subtitle}>回复完成后复制哪些内容</Text>
            </View>
            <Pressable style={styles.closeButton} hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={20} color="#111111" />
            </Pressable>
          </View>

          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>回复后自动复制</Text>
              <Text style={styles.toggleDescription}>
                关闭后，回复完成时不会自动写入剪贴板
              </Text>
            </View>
            <Switch
              value={autoCopyEnabled}
              onValueChange={onSetAutoCopyEnabled}
              trackColor={{ false: "#D5DAE4", true: "#C8C0FF" }}
              thumbColor={autoCopyEnabled ? "#8E7BFF" : "#FFFFFF"}
            />
          </View>

          <View style={styles.options}>
            {options.map((option) => {
              const selected = selectedMode === option.mode;

              return (
                <Pressable
                  key={option.mode}
                  style={[
                    styles.option,
                    selected && autoCopyEnabled && styles.optionSelected,
                    !autoCopyEnabled && styles.optionDisabled,
                  ]}
                  onPress={() => onSelectMode(option.mode)}
                  disabled={!autoCopyEnabled}
                >
                  <View style={styles.optionTextWrap}>
                    <Text
                      style={[
                        styles.optionLabel,
                        selected && autoCopyEnabled && styles.optionLabelSelected,
                        !autoCopyEnabled && styles.optionTextDisabled,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text
                      style={[
                        styles.optionDescription,
                        !autoCopyEnabled && styles.optionTextDisabled,
                      ]}
                    >
                      {option.description}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      selected && autoCopyEnabled && styles.radioSelected,
                      !autoCopyEnabled && styles.radioDisabled,
                    ]}
                  >
                    {selected && autoCopyEnabled ? (
                      <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
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
