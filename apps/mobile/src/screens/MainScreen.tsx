import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadDebugSettings, saveDebugSettings } from "../services/preferences/debugSettingsStorage";
import { getAiOptions, type AiProviderOption } from "../services/api/aiOptionsApi";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { CHAT_CONTACTS, type ChatContact } from "../domain/chat/contacts";

type MainScreenProps = {
  onOpenChat: (contact: ChatContact) => void;
};

const SHOW_DEBUG_PROMPT_PANEL = process.env.EXPO_PUBLIC_SHOW_DEBUG_PROMPT_PANEL === "true";

export function MainScreen({ onOpenChat }: MainScreenProps) {
  const { isMounted } = useMountedGuard();
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [rewriteAssistantPromptDraft, setRewriteAssistantPromptDraft] = useState("");
  const [englishFriendPromptDraft, setEnglishFriendPromptDraft] = useState("");
  const [aiProviders, setAiProviders] = useState<AiProviderOption[]>([]);
  const [providerDraft, setProviderDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");

  useEffect(() => {
    if (!SHOW_DEBUG_PROMPT_PANEL) return;
    async function bootstrapDebugSettings() {
      const [settings, options] = await Promise.all([
        loadDebugSettings(),
        getAiOptions().catch(() => null),
      ]);
      if (!isMounted()) return;
      const providers = options?.providers ?? [];
      const provider = settings.provider || options?.defaultProvider || providers[0]?.id || "";
      const selectedProvider = providers.find((item) => item.id === provider) ?? providers[0];
      const model = settings.model || selectedProvider?.defaultModel || selectedProvider?.models[0] || "";
      setAiProviders(providers);
      setRewriteAssistantPromptDraft(settings.systemPromptsByContactId.rewrite_assistant ?? "");
      setEnglishFriendPromptDraft(settings.systemPromptsByContactId.english_friend ?? "");
      setProviderDraft(provider);
      setModelDraft(model);
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
      provider: providerDraft,
      model: modelDraft.trim(),
    });
    setIsDebugOpen(false);
  }

  function handleSelectProvider(providerId: string): void {
    setProviderDraft(providerId);
    const provider = aiProviders.find((item) => item.id === providerId);
    setModelDraft(provider?.defaultModel || provider?.models[0] || "");
  }

  const selectedProvider = aiProviders.find((item) => item.id === providerDraft);
  const modelOptions = selectedProvider?.models ?? [];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <View>
            <Text style={styles.brand}>OIO</Text>
            <Text style={styles.brandSubtext}>今天过得怎么样？</Text>
          </View>
          {SHOW_DEBUG_PROMPT_PANEL ? (
            <Pressable style={styles.debugButton} onPress={() => setIsDebugOpen(true)} hitSlop={8}>
              <Ionicons name="settings-outline" size={16} color="#5D6470" />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.conversationStack}>
          {CHAT_CONTACTS.map((contact) => (
            <Pressable
              key={contact.id}
              style={[
                styles.conversationRow,
                contact.id === "rewrite_assistant" && styles.conversationRowPrimary,
              ]}
              onPress={() => onOpenChat(contact)}
            >
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{contact.avatarLabel}</Text>
              </View>
              <View style={styles.conversationBody}>
                <Text style={styles.conversationTitle}>{contact.name}</Text>
                <Text style={styles.conversationSubtitle}>{contact.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9AA0AB" />
            </Pressable>
          ))}
        </View>

        <View style={styles.emptyArea}>
          <View style={styles.promptCard}>
            <View style={styles.promptHeader}>
              <View style={styles.promptMark} />
              <Text style={styles.emptyTitle}>不知道说什么时</Text>
            </View>
            <Text style={styles.emptyHint}>从生活日常开始</Text>
            <View style={styles.promptStack}>
              {["有没有好的想法计划？", "今天经历了什么印象深刻的事情？", "今天有没有一个小小的变化？"].map((prompt) => (
                <View key={prompt} style={styles.promptPill}>
                  <Text style={styles.promptText}>{prompt}</Text>
                </View>
              ))}
            </View>
          </View>
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
              <Text style={styles.fieldLabel}>AI 服务</Text>
              <View style={styles.optionGrid}>
                {aiProviders.map((provider) => {
                  const active = providerDraft === provider.id;
                  return (
                    <Pressable
                      key={provider.id}
                      style={[styles.optionChip, active && styles.optionChipActive]}
                      onPress={() => handleSelectProvider(provider.id)}
                    >
                      <Text style={[styles.optionText, active && styles.optionTextActive]}>
                        {provider.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>测试模型</Text>
              <View style={styles.optionGrid}>
                {modelOptions.map((model) => {
                  const active = modelDraft === model;
                  return (
                    <Pressable
                      key={model}
                      style={[styles.optionChip, styles.modelChip, active && styles.optionChipActive]}
                      onPress={() => setModelDraft(model)}
                    >
                      <Text style={[styles.optionText, active && styles.optionTextActive]}>{model}</Text>
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
    backgroundColor: "#F7F8FA",
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
    color: "#151515",
    fontSize: 23,
    fontWeight: "500",
  },
  brandSubtext: {
    marginTop: 6,
    color: "#737A86",
    fontSize: 14,
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

  conversationStack: {
    marginTop: 28,
    gap: 12,
  },
  conversationRow: {
    minHeight: 82,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E4E5EA",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  conversationRowPrimary: {
    backgroundColor: "#F1F0FF",
    borderColor: "#E3DFFF",
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#DADCE4",
    backgroundColor: "rgba(255,255,255,0.72)",
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
    marginLeft: 13,
    paddingRight: 12,
  },
  conversationTitle: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "500",
  },
  conversationSubtitle: {
    marginTop: 4,
    color: "#7E8491",
    fontSize: 14,
    lineHeight: 20,
  },
  emptyArea: {
    flex: 1,
    paddingBottom: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  promptCard: {
    width: "86%",
    maxWidth: 330,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7E8ED",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  promptHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  promptMark: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#746BFF",
  },
  emptyTitle: {
    marginLeft: 8,
    color: "#4F5663",
    fontSize: 13,
    fontWeight: "500",
  },
  emptyHint: {
    marginTop: 7,
    color: "#8B909B",
    fontSize: 12,
    lineHeight: 17,
  },
  promptStack: {
    marginTop: 12,
    gap: 8,
  },
  promptPill: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E9EE",
    backgroundColor: "#FFFFFF",
  },
  promptText: {
    color: "#626977",
    fontSize: 13,
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
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    minHeight: 38,
    minWidth: 94,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  modelChip: {
    alignItems: "flex-start",
  },
  optionChipActive: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  optionText: {
    maxWidth: 260,
    color: "#5D6470",
    fontSize: 13,
    fontWeight: "700",
  },
  optionTextActive: {
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
