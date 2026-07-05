import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AppLocale, LearningLanguage, PromptDifficulty, PromptStyle } from "../../services/api/meApi";
import { t } from "../../i18n";

export function UiLocaleSetupModal({
  visible,
  value,
  onChange,
  onContinue,
}: {
  visible: boolean;
  value: AppLocale;
  onChange: (value: AppLocale) => void;
  onContinue: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <Text style={styles.title}>{t("onboarding.ui_locale.title")}</Text>
          <Text style={styles.subtitle}>{t("onboarding.ui_locale.subtitle")}</Text>
          <View style={styles.optionGrid}>
            {APP_LOCALE_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={t(option.labelKey)}
                active={value === option.value}
                onPress={() => onChange(option.value)}
              />
            ))}
          </View>
          <Pressable style={styles.primaryButton} onPress={onContinue}>
            <Text style={styles.primaryButtonText}>{t("common.continue")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function LearningPreferenceModal({
  visible,
  learningLanguage,
  promptDifficulty,
  promptStyle,
  saving,
  onChangeLearningLanguage,
  onChangePromptDifficulty,
  onChangePromptStyle,
  onContinue,
}: {
  visible: boolean;
  learningLanguage: LearningLanguage;
  promptDifficulty: PromptDifficulty;
  promptStyle: PromptStyle;
  saving: boolean;
  onChangeLearningLanguage: (value: LearningLanguage) => void;
  onChangePromptDifficulty: (value: PromptDifficulty) => void;
  onChangePromptStyle: (value: PromptStyle) => void;
  onContinue: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <Text style={styles.title}>{t("onboarding.learning.title")}</Text>
          <Text style={styles.subtitle}>{t("onboarding.learning.subtitle")}</Text>

          <Text style={styles.fieldTitle}>{t("me.language.learning")}</Text>
          <View style={styles.optionGrid}>
            {LEARNING_LANGUAGE_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={t(option.labelKey)}
                active={learningLanguage === option.value}
                onPress={() => onChangeLearningLanguage(option.value)}
              />
            ))}
          </View>

          <Text style={styles.fieldTitle}>{t("me.language.difficulty")}</Text>
          <View style={styles.optionGrid}>
            {PROMPT_DIFFICULTY_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={t(option.labelKey)}
                active={promptDifficulty === option.value}
                onPress={() => onChangePromptDifficulty(option.value)}
              />
            ))}
          </View>

          <Text style={styles.fieldTitle}>{t("me.language.style")}</Text>
          <View style={styles.optionGrid}>
            {PROMPT_STYLE_OPTIONS.map((option) => (
              <OptionChip
                key={option.value}
                label={promptStyleLabel(option.value, learningLanguage)}
                active={promptStyle === option.value}
                onPress={() => onChangePromptStyle(option.value)}
              />
            ))}
          </View>

          <Text style={styles.note}>{t("onboarding.learning.settings_hint")}</Text>
          <Pressable style={[styles.primaryButton, saving && styles.buttonDisabled]} onPress={onContinue} disabled={saving}>
            <Text style={styles.primaryButtonText}>{saving ? t("common.saving") : t("common.continue")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function LearningFlowHelpModal({
  visible,
  mode,
  onClose,
  onDone,
}: {
  visible: boolean;
  mode: "onboarding" | "manual";
  onClose?: () => void;
  onDone: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={mode === "manual" ? onClose : undefined}>
      <View style={styles.backdrop}>
        <View style={styles.helpPanel}>
          <View style={styles.helpHeader}>
            <Text style={styles.title}>{t("help.learning_flow.title")}</Text>
            {mode === "manual" && onClose ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} style={styles.iconButton} onPress={onClose}>
                <Ionicons name="close" size={22} color="#111111" />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.subtitle}>{t("help.learning_flow.subtitle")}</Text>
          <ScrollView style={styles.helpBody} contentContainerStyle={styles.helpContent} showsVerticalScrollIndicator={false}>
            <HelpStep index="1" title={t("help.learning_flow.chat.title")} body={t("help.learning_flow.chat.point_rewrite")} />
            <HelpStep index="2" title={t("help.learning_flow.cloze.title")} body={t("help.learning_flow.cloze.point_manual")} />
            <HelpStep index="3" title={t("help.learning_flow.review.title")} body={t("help.learning_flow.review.point_practice")} />
            <Text style={styles.note}>{t("help.learning_flow.footer")}</Text>
          </ScrollView>
          <Pressable style={styles.primaryButton} onPress={onDone}>
            <Text style={styles.primaryButtonText}>
              {mode === "onboarding" ? t("help.learning_flow.start") : t("common.got_it")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function HelpStep({ index, title, body }: { index: string; title: string; body: string }) {
  return (
    <View style={styles.helpStep}>
      <View style={styles.stepIndex}>
        <Text style={styles.stepIndexText}>{index}</Text>
      </View>
      <View style={styles.stepBody}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepText}>{body}</Text>
      </View>
    </View>
  );
}

function OptionChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.optionChip, active && styles.optionChipActive]} onPress={onPress}>
      <Text style={[styles.optionText, active && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

const APP_LOCALE_OPTIONS: Array<{ value: AppLocale; labelKey: Parameters<typeof t>[0] }> = [
  { value: "zh-CN", labelKey: "language.zh_cn" },
  { value: "zh-TW", labelKey: "language.zh_tw" },
  { value: "en-US", labelKey: "language.en_us" },
  { value: "ja-JP", labelKey: "language.ja_jp" },
];

const LEARNING_LANGUAGE_OPTIONS: Array<{ value: LearningLanguage; labelKey: Parameters<typeof t>[0] }> = [
  { value: "en-US", labelKey: "learning.en_us" },
  { value: "ja-JP", labelKey: "learning.ja_jp" },
];

const PROMPT_DIFFICULTY_OPTIONS: Array<{ value: PromptDifficulty; labelKey: Parameters<typeof t>[0] }> = [
  { value: "simple", labelKey: "prompt_difficulty.simple" },
  { value: "natural", labelKey: "prompt_difficulty.natural" },
  { value: "native", labelKey: "prompt_difficulty.native" },
];

const PROMPT_STYLE_OPTIONS: Array<{ value: PromptStyle }> = [
  { value: "native_casual" },
  { value: "standard" },
];

function promptStyleLabel(value: PromptStyle, learningLanguage: LearningLanguage): string {
  if (value === "native_casual") {
    return t(learningLanguage === "ja-JP" ? "prompt_style.native_casual.ja" : "prompt_style.native_casual.en");
  }
  return t("prompt_style.standard");
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    paddingHorizontal: 18,
    backgroundColor: "rgba(17, 17, 17, 0.34)",
    justifyContent: "center",
  },
  panel: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  helpPanel: {
    maxHeight: "82%",
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  helpHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    color: "#111111",
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 8,
    color: "#606775",
    fontSize: 13,
    lineHeight: 19,
  },
  fieldTitle: {
    marginTop: 18,
    color: "#343A45",
    fontSize: 13,
    fontWeight: "700",
  },
  optionGrid: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    minHeight: 40,
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  optionChipActive: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  optionText: {
    color: "#5D6470",
    fontSize: 13,
    fontWeight: "600",
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  note: {
    marginTop: 16,
    color: "#7E8491",
    fontSize: 12,
    lineHeight: 17,
  },
  primaryButton: {
    marginTop: 18,
    height: 46,
    borderRadius: 13,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.62,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  helpBody: {
    marginTop: 12,
  },
  helpContent: {
    paddingBottom: 2,
  },
  helpStep: {
    marginTop: 12,
    flexDirection: "row",
    gap: 12,
  },
  stepIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F0EDFF",
    alignItems: "center",
    justifyContent: "center",
  },
  stepIndexText: {
    color: "#4E3EFF",
    fontSize: 13,
    fontWeight: "700",
  },
  stepBody: {
    flex: 1,
  },
  stepTitle: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
  },
  stepText: {
    marginTop: 4,
    color: "#5E6573",
    fontSize: 13,
    lineHeight: 19,
  },
});
