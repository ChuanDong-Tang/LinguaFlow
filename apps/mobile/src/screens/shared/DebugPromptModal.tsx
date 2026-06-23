import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { loadDebugSettings, saveDebugSettings } from "../../services/preferences/debugSettingsStorage";
import { getAiOptions, type AiProviderOption } from "../../services/api/aiOptionsApi";
import { useMountedGuard } from "../../hooks/useMountedGuard";

export function DebugPromptModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { isMounted } = useMountedGuard();
  const [rewriteAssistantPromptDraft, setRewriteAssistantPromptDraft] = useState("");
  const [englishFriendPromptDraft, setEnglishFriendPromptDraft] = useState("");
  const [aiProviders, setAiProviders] = useState<AiProviderOption[]>([]);
  const [providerDraft, setProviderDraft] = useState("");
  const [modelDraft, setModelDraft] = useState("");

  useEffect(() => {
    if (!visible) return;
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
  }, [isMounted, visible]);

  async function handleSaveDebugSystemPrompt(): Promise<void> {
    const current = await loadDebugSettings();
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
    onClose();
  }

  function handleSelectProvider(providerId: string): void {
    setProviderDraft(providerId);
    const provider = aiProviders.find((item) => item.id === providerId);
    setModelDraft(provider?.defaultModel || provider?.models[0] || "");
  }

  const selectedProvider = aiProviders.find((item) => item.id === providerDraft);
  const modelOptions = selectedProvider?.models ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.debugPanel}>
          <Text style={styles.debugTitle}>AI 调试设置</Text>
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
          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.saveButton} onPress={() => void handleSaveDebugSystemPrompt()}>
              <Text style={styles.saveText}>保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  actions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8DAE0",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "700",
  },
  saveButton: {
    flex: 1,
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
