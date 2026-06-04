import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatContact } from "../../domain/chat/contacts";
import type { AutoCopyMode } from "../../services/preferences/assistantPreferences";

type AutoCopySheetProps = {
  visible: boolean;
  contact: ChatContact;
  selectedMode: AutoCopyMode;
  onClose: () => void;
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
  selectedMode,
  onClose,
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

          <View style={styles.options}>
            {options.map((option) => {
              const selected = selectedMode === option.mode;

              return (
                <Pressable
                  key={option.mode}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => onSelectMode(option.mode)}
                >
                  <View style={styles.optionTextWrap}>
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                      {option.label}
                    </Text>
                    <Text style={styles.optionDescription}>{option.description}</Text>
                  </View>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
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
});
