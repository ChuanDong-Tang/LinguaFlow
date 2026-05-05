import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { TabBar } from "./shared/TabBar";
import {
  type DebugModelProvider,
  loadDebugSettings,
  saveDebugSettings,
} from "../services/debugSettingsStorage";

type MainScreenProps = {
  onOpenChat: () => void;
  onOpenMe: () => void;
};

const SHOW_DEBUG_PROMPT_PANEL = process.env.EXPO_PUBLIC_SHOW_DEBUG_PROMPT_PANEL === "true";
const MODEL_OPTIONS: Array<{ label: string; value: DebugModelProvider; disabled?: boolean }> = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "Kimi", value: "kimi", disabled: true },
  { label: "讯飞", value: "xunfei", disabled: true },
];

export function MainScreen({ onOpenChat, onOpenMe }: MainScreenProps) {
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const [modelProvider, setModelProvider] = useState<DebugModelProvider>("deepseek");

  useEffect(() => {
    if (!SHOW_DEBUG_PROMPT_PANEL) return;
    let mounted = true;
    async function bootstrapDebugSettings() {
      const settings = await loadDebugSettings();
      if (!mounted) return;
      setSystemPromptDraft(settings.systemPrompt);
      setModelProvider(settings.modelProvider);
    }
    void bootstrapDebugSettings();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSaveDebugSystemPrompt(): Promise<void> {
    const current = await loadDebugSettings();
    await saveDebugSettings({
      ...current,
      systemPrompt: systemPromptDraft,
      modelProvider,
    });
    setIsDebugOpen(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>OIO</Text>
          <Ionicons name="sparkles-outline" size={19} color="#A99BFF" />
          {SHOW_DEBUG_PROMPT_PANEL ? (
            <Pressable style={styles.debugButton} onPress={() => setIsDebugOpen(true)} hitSlop={8}>
              <Ionicons name="settings-outline" size={16} color="#5D6470" />
            </Pressable>
          ) : null}
        </View>

        <Pressable style={styles.conversationRow} onPress={onOpenChat}>
          <View style={styles.avatarCircle}>
            <MaterialCommunityIcons name="ghost" size={36} color="#111111" />
          </View>

          <View style={styles.conversationBody}>
            <Text style={styles.conversationTitle}>好奇输入助手</Text>
            <Text style={styles.conversationSubtitle}>把中文想法，说成自然英文</Text>
          </View>

          <View style={styles.conversationMeta}>
            <Text style={styles.time}>09:41</Text>
            <Ionicons name="chevron-forward" size={23} color="#8C8F97" />
          </View>
        </Pressable>

        <View style={styles.divider} />

        <View style={styles.emptyArea}>
          <View style={styles.illustration}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={54}
              color="#A99BFF"
              style={styles.bubbleIcon}
            />
            <View style={styles.ghostLargeWrap}>
              <MaterialCommunityIcons name="ghost" size={96} color="#111111" />
              <Ionicons name="sparkles-outline" size={18} color="#A99BFF" style={styles.sparkIcon} />
            </View>
          </View>
          <Text style={styles.emptyText}>想到什么，就从一句话开始</Text>
        </View>
      </View>

      <TabBar activeTab="chat" onPressChat={onOpenChat} onPressMe={onOpenMe} />

      {SHOW_DEBUG_PROMPT_PANEL ? (
        <Modal visible={isDebugOpen} transparent animationType="fade" onRequestClose={() => setIsDebugOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.debugPanel}>
              <View style={styles.debugHeader}>
                <View>
                  <Text style={styles.debugTitle}>调试设置</Text>
                  <Text style={styles.debugSubtitle}>替换系统 Prompt，仅保存在本机</Text>
                </View>
                <Pressable style={styles.closeButton} onPress={() => setIsDebugOpen(false)} hitSlop={8}>
                  <Text style={styles.closeText}>×</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>System Prompt</Text>
              <TextInput
                style={styles.promptInput}
                value={systemPromptDraft}
                onChangeText={setSystemPromptDraft}
                placeholder="留空则使用服务端默认 prompt"
                placeholderTextColor="#A5ABB5"
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.fieldLabel}>模型</Text>
              <View style={styles.modelRow}>
                {MODEL_OPTIONS.map((option) => {
                  const active = modelProvider === option.value;
                  const disabled = option.disabled === true;
                  return (
                    <Pressable
                      key={option.value}
                      style={[
                        styles.modelOption,
                        active && styles.modelOptionActive,
                        disabled && styles.modelOptionDisabled,
                      ]}
                      onPress={() => {
                        if (!disabled) setModelProvider(option.value);
                      }}
                      disabled={disabled}
                    >
                      <Text
                        style={[
                          styles.modelText,
                          active && styles.modelTextActive,
                          disabled && styles.modelTextDisabled,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.debugActions}>
                <Pressable
                  style={styles.clearButton}
                  onPress={() => {
                    setSystemPromptDraft("");
                    setModelProvider("deepseek");
                  }}
                >
                  <Text style={styles.clearText}>清空</Text>
                </Pressable>
                <Pressable style={styles.saveButton} onPress={() => void handleSaveDebugSystemPrompt()}>
                  <Text style={styles.saveText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
  },
  brandRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  debugButton: {
    marginLeft: "auto",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F1F2F4",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: "#090909",
    fontSize: 25,
    fontWeight: "500",
  },
  conversationRow: {
    marginTop: 58,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  conversationBody: {
    flex: 1,
    marginLeft: 18,
    paddingRight: 12,
  },
  conversationTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
  },
  conversationSubtitle: {
    marginTop: 6,
    color: "#7E8491",
    fontSize: 15,
    lineHeight: 21,
  },
  conversationMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  time: {
    color: "#8B8F97",
    fontSize: 15,
  },
  divider: {
    marginTop: 28,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  emptyArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 92,
  },
  illustration: {
    width: 190,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleIcon: {
    position: "absolute",
    left: 8,
    top: 20,
  },
  ghostLargeWrap: {
    position: "absolute",
    right: 18,
    top: 34,
    width: 126,
    height: 126,
    alignItems: "center",
    justifyContent: "center",
  },
  sparkIcon: {
    position: "absolute",
    right: 4,
    top: -2,
  },
  emptyText: {
    marginTop: 14,
    color: "#C3C6CE",
    fontSize: 14,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17, 17, 17, 0.38)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  debugPanel: {
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    padding: 18,
  },
  debugHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  debugTitle: {
    color: "#111111",
    fontSize: 22,
    fontWeight: "700",
  },
  debugSubtitle: {
    marginTop: 4,
    color: "#7A7F8C",
    fontSize: 13,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: {
    color: "#5D6470",
    fontSize: 30,
    lineHeight: 32,
  },
  fieldLabel: {
    marginTop: 18,
    marginBottom: 8,
    color: "#343A45",
    fontSize: 14,
    fontWeight: "700",
  },
  promptInput: {
    minHeight: 170,
    maxHeight: 240,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: "#151922",
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: "#FAFBFC",
  },
  modelRow: {
    flexDirection: "row",
    gap: 8,
  },
  modelOption: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  modelOptionActive: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  modelOptionDisabled: {
    borderColor: "#E7EAF0",
    backgroundColor: "#F6F7F9",
  },
  modelText: {
    color: "#5D6470",
    fontSize: 13,
    fontWeight: "700",
  },
  modelTextActive: {
    color: "#FFFFFF",
  },
  modelTextDisabled: {
    color: "#B0B6C0",
  },
  debugActions: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  clearButton: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#F1F2F4",
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: {
    color: "#5D6470",
    fontSize: 14,
    fontWeight: "700",
  },
  saveButton: {
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
