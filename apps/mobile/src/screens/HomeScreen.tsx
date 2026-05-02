import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  DebugModelProvider,
  loadDebugSettings,
  saveDebugSettings,
} from "../services/debugSettingsStorage";

type HomeScreenProps = {
  onOpenChat: () => void;
  onLogout: () => Promise<void> | void;
};

export function HomeScreen({ onOpenChat, onLogout }: HomeScreenProps) {
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelProvider, setModelProvider] = useState<DebugModelProvider>("deepseek");

  useEffect(() => {
    let mounted = true;
    async function loadSettings() {
      const settings = await loadDebugSettings();
      if (!mounted) return;
      setSystemPrompt(settings.systemPrompt);
      setModelProvider(settings.modelProvider);
    }
    void loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSaveDebugSettings(): Promise<void> {
    await saveDebugSettings({
      systemPrompt,
      modelProvider,
    });
    setIsDebugOpen(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View>
            <Text style={styles.brand}>OIO Lab</Text>
            <Text style={styles.pageName}>好友</Text>
          </View>

          <Pressable style={styles.settingsButton} onPress={() => setIsDebugOpen(true)} hitSlop={8}>
            <Text style={styles.settingsText}>⚙</Text>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchPlaceholder}>搜索</Text>
        </View>

        <Pressable style={styles.friendRow} onPress={onOpenChat}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatarInner} />
          </View>

          <View style={styles.friendBody}>
            <Text style={styles.friendName}>好奇输入助手</Text>
            <Text style={styles.friendDesc}>测试文案：帮你把英文说得更自然</Text>
          </View>

          <View style={styles.friendMeta}>
            <Text style={styles.timeText}>09:41</Text>
            <Text style={styles.arrowText}>›</Text>
          </View>
        </Pressable>

        <View style={styles.separator} />

        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>◌◌</Text>
          <Text style={styles.emptyTitle}>暂时只有一个好友</Text>
          <Text style={styles.emptySubTitle}>测试文案：但他已经很厉害了</Text>
        </View>

        <Pressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>退出登录（测试）</Text>
        </Pressable>
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.tabItem}>
          <Text style={styles.tabIconActive}>●</Text>
          <Text style={styles.tabTextActive}>对话</Text>
        </View>
        <View style={styles.tabItem}>
          <Text style={styles.tabIcon}>◯</Text>
          <Text style={styles.tabText}>我</Text>
        </View>
      </View>

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
              value={systemPrompt}
              onChangeText={setSystemPrompt}
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
                  setSystemPrompt("");
                  setModelProvider("deepseek");
                }}
              >
                <Text style={styles.clearText}>清空</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={handleSaveDebugSettings}>
                <Text style={styles.saveText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const MODEL_OPTIONS: Array<{ label: string; value: DebugModelProvider; disabled?: boolean }> = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "Kimi", value: "kimi", disabled: true },
  { label: "讯飞", value: "xunfei", disabled: true },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
  },
  topRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  brand: {
    fontSize: 52,
    fontWeight: "700",
    color: "#111111",
    letterSpacing: -0.8,
  },
  pageName: {
    marginTop: 4,
    fontSize: 16,
    color: "#8A8E99",
  },
  settingsButton: {
    marginTop: 8,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F1F2F4",
    alignItems: "center",
    justifyContent: "center",
  },
  settingsText: {
    color: "#343A45",
    fontSize: 20,
    lineHeight: 24,
  },
  searchWrap: {
    marginTop: 30,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#F1F2F4",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  searchIcon: {
    color: "#B2B6C0",
    fontSize: 22,
    marginRight: 10,
  },
  searchPlaceholder: {
    color: "#B2B6C0",
    fontSize: 16,
  },
  friendRow: {
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#ECEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#D6D4FA",
  },
  friendBody: {
    marginLeft: 14,
    flex: 1,
  },
  friendName: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111111",
  },
  friendDesc: {
    marginTop: 4,
    color: "#7A7F8C",
    fontSize: 14,
  },
  friendMeta: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    alignSelf: "stretch",
    paddingVertical: 4,
  },
  timeText: {
    color: "#979DA8",
    fontSize: 13,
  },
  arrowText: {
    color: "#B8BDC7",
    fontSize: 28,
    lineHeight: 28,
  },
  separator: {
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF0F3",
  },
  emptyWrap: {
    marginTop: 240,
    alignItems: "center",
  },
  emptyIcon: {
    color: "#C9CDD5",
    fontSize: 24,
    letterSpacing: 2,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 20,
    color: "#3C414B",
    fontWeight: "600",
  },
  emptySubTitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#9AA0AB",
  },
  logoutButton: {
    marginTop: "auto",
    marginBottom: 16,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  logoutText: {
    color: "#8F95A1",
    fontSize: 12,
  },
  bottomBar: {
    height: 78,
    borderTopWidth: 1,
    borderTopColor: "#ECEEF2",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  tabItem: {
    alignItems: "center",
  },
  tabIconActive: {
    fontSize: 20,
    color: "#111111",
  },
  tabIcon: {
    fontSize: 20,
    color: "#111111",
  },
  tabTextActive: {
    marginTop: 2,
    fontSize: 14,
    color: "#111111",
    fontWeight: "600",
  },
  tabText: {
    marginTop: 2,
    fontSize: 14,
    color: "#5D6470",
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
