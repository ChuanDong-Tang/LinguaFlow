import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { type DebugModelProvider, loadDebugSettings, saveDebugSettings } from "../services/preferences/debugSettingsStorage";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { CHAT_CONTACTS, type ChatContact } from "../domain/chat/contacts";

type MainScreenProps = {
  onOpenChat: (contact: ChatContact) => void;
};

const SHOW_DEBUG_PROMPT_PANEL = process.env.EXPO_PUBLIC_SHOW_DEBUG_PROMPT_PANEL === "true";
const MODEL_OPTIONS: Array<{ label: string; value: DebugModelProvider; disabled?: boolean }> = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "Kimi", value: "kimi", disabled: true },
  { label: "讯飞", value: "xunfei", disabled: true },
];

export function MainScreen({ onOpenChat }: MainScreenProps) {
  const { isMounted } = useMountedGuard();
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [rewriteAssistantPromptDraft, setRewriteAssistantPromptDraft] = useState("");
  const [englishFriendPromptDraft, setEnglishFriendPromptDraft] = useState("");
  const [modelProvider, setModelProvider] = useState<DebugModelProvider>("deepseek");

  useEffect(() => {
    if (!SHOW_DEBUG_PROMPT_PANEL) return;
    async function bootstrapDebugSettings() {
      const settings = await loadDebugSettings();
      if (!isMounted()) return;
      setRewriteAssistantPromptDraft(settings.systemPromptsByContactId.rewrite_assistant ?? "");
      setEnglishFriendPromptDraft(settings.systemPromptsByContactId.english_friend ?? "");
      setModelProvider(settings.modelProvider);
    }
    void bootstrapDebugSettings();
  }, [isMounted]);

  async function handleSaveDebugSystemPrompt(): Promise<void> {
    const current = await loadDebugSettings();

    // 调试面板只覆盖当前编辑项，避免把未来新增的调试配置误清空。
    await saveDebugSettings({
      ...current,
      systemPromptsByContactId: {
        ...current.systemPromptsByContactId,
        rewrite_assistant: rewriteAssistantPromptDraft,
        english_friend: englishFriendPromptDraft,
      },
      modelProvider,
    });
    setIsDebugOpen(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>OIO</Text>
          {SHOW_DEBUG_PROMPT_PANEL ? (
            <Pressable style={styles.debugButton} onPress={() => setIsDebugOpen(true)} hitSlop={8}>
              <Ionicons name="settings-outline" size={16} color="#5D6470" />
            </Pressable>
          ) : null}
        </View>

        {CHAT_CONTACTS.map((contact, index) => (
          <React.Fragment key={contact.id}>
            <Pressable style={styles.conversationRow} onPress={() => onOpenChat(contact)}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{contact.avatarLabel}</Text>
              </View>
              <View style={styles.conversationBody}>
                <Text style={styles.conversationTitle}>{contact.name}</Text>
                <Text style={styles.conversationSubtitle}>{contact.description}</Text>
              </View>
            </Pressable>
            {index < CHAT_CONTACTS.length - 1 ? <View style={styles.divider} /> : null}
          </React.Fragment>
        ))}

        <View style={styles.emptyArea}>
          <Ionicons name="chatbubble-ellipses-outline" size={60} color="#222222" />
          <Text style={styles.emptyText}>想到什么，就从一句话开始</Text>
        </View>
      </View>

      {SHOW_DEBUG_PROMPT_PANEL ? (
        <Modal visible={isDebugOpen} transparent animationType="fade" onRequestClose={() => setIsDebugOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.debugPanel}>
              <Text style={styles.debugTitle}>调试设置</Text>
              <Text style={styles.fieldLabel}>改写助手 Prompt</Text>
              <TextInput
                style={styles.promptInput}
                value={rewriteAssistantPromptDraft}
                onChangeText={setRewriteAssistantPromptDraft}
                placeholder="留空则使用服务端默认改写助手 prompt"
                placeholderTextColor="#A5ABB5"
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.fieldLabel}>好奇宝宝 Prompt</Text>
              <TextInput
                style={styles.promptInput}
                value={englishFriendPromptDraft}
                onChangeText={setEnglishFriendPromptDraft}
                placeholder="留空则使用服务端默认好奇宝宝 prompt"
                placeholderTextColor="#A5ABB5"
                multiline
                textAlignVertical="top"
              />
              <View style={styles.modelRow}>
                {MODEL_OPTIONS.map((option) => {
                  const active = modelProvider === option.value;

                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.modelOption, active && styles.modelOptionActive]}
                      onPress={() => !option.disabled && setModelProvider(option.value)}
                    >
                      <Text style={[styles.modelText, active && styles.modelTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable style={styles.saveButton} onPress={() => void handleSaveDebugSystemPrompt()}>
                <Text style={styles.saveText}>保存</Text>
              </Pressable>
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
    backgroundColor: "#FCFCFD",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },

  brandRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  brand: {
    color: "#090909",
    fontSize: 24,
    fontWeight: "500",
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

  conversationRow: {
    marginTop: 30,
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: "#DCDDE4",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#33333a",
    fontSize: 15,
    letterSpacing: 1,
  },
  conversationBody: {
    flex: 1,
    marginLeft: 14,
    paddingRight: 12,
  },
  conversationTitle: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "600",
  },
  conversationSubtitle: {
    marginTop: 4,
    color: "#7E8491",
    fontSize: 14,
    lineHeight: 20,
  },
  divider: {
    marginTop: 24,
    height: 1,
    backgroundColor: "#E5E7EB",
  },

  emptyArea: {
    flex: 1,
    paddingBottom: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    marginTop: 20,
    color: "#8E93A0",
    fontSize: 16,
  },

  modalBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: "rgba(17,17,17,0.38)",
    justifyContent: "center",
  },
  debugPanel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  debugTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
  },
  fieldLabel: {
    marginTop: 14,
    marginBottom: 8,
    color: "#343A45",
    fontSize: 13,
    fontWeight: "700",
  },
  promptInput: {
    minHeight: 120,
    maxHeight: 190,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FAFBFC",
    color: "#151922",
    fontSize: 14,
  },
  modelRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  modelOption: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  modelOptionActive: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  modelText: {
    color: "#5D6470",
    fontSize: 13,
    fontWeight: "700",
  },
  modelTextActive: {
    color: "#FFFFFF",
  },
  saveButton: {
    marginTop: 12,
    height: 42,
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
