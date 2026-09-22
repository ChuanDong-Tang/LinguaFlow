import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AcquisitionSource } from "@lf/core/ports/repository/UserPreferenceRepository";
import { t, tf } from "../i18n";
import type { AppLocale, LearningLanguage, PromptDifficulty } from "../services/api/meApi";
import type {
  PreLoginOnboardingDraft,
  PreLoginOnboardingStep,
} from "../services/preferences/preLoginOnboarding";
import { theme } from "../theme";

type Props = {
  step: PreLoginOnboardingStep;
  draft: PreLoginOnboardingDraft;
  onChangeDraft: (draft: PreLoginOnboardingDraft) => void;
  onBack: () => void;
  onContinue: () => void;
};

export function PreLoginOnboardingScreen({ step, draft, onChangeDraft, onBack, onContinue }: Props) {
  const content = stepContent(step);
  const selected = selectedValue(step, draft);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {step > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("onboarding.flow.back")} style={styles.backButton} onPress={onBack}>
              <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.progressText}>{tf("onboarding.flow.progress", { current: step + 1, total: 4 })}</Text>
        <View style={styles.headerSide} />
      </View>

      <View style={styles.progressTrack}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={[styles.progressSegment, index <= step && styles.progressSegmentActive]} />
        ))}
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.eyebrow}>OIO</Text>
          <Text style={styles.title}>{t(content.titleKey)}</Text>
          <Text style={styles.subtitle}>{t(content.subtitleKey)}</Text>
        </View>

        <View style={styles.options}>
          {content.options.map((option) => {
            const active = selected === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => onChangeDraft(updateDraft(step, draft, option.value))}
              >
                <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                  <Ionicons name={option.icon} size={20} color={active ? "#FFFFFF" : theme.colors.textSecondary} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{option.label}</Text>
                  {option.detail ? <Text style={styles.optionDetail}>{option.detail}</Text> : null}
                </View>
                <View style={[styles.radio, active && styles.radioActive]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={!selected}
          style={[styles.continueButton, !selected && styles.continueButtonDisabled]}
          onPress={onContinue}
        >
          <Text style={styles.continueText}>{step === 3 ? t("onboarding.flow.finish") : t("common.continue")}</Text>
          <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

type Option = {
  value: string;
  label: string;
  detail?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

function stepContent(step: PreLoginOnboardingStep): {
  titleKey: Parameters<typeof t>[0];
  subtitleKey: Parameters<typeof t>[0];
  options: Option[];
} {
  if (step === 0) {
    return {
      titleKey: "onboarding.flow.app_language.title",
      subtitleKey: "onboarding.flow.app_language.subtitle",
      options: [
        { value: "zh-CN", label: "简体中文", icon: "language-outline" },
        { value: "zh-TW", label: "繁體中文", icon: "language-outline" },
        { value: "en-US", label: "English", icon: "language-outline" },
        { value: "ja-JP", label: "日本語", icon: "language-outline" },
      ],
    };
  }
  if (step === 1) {
    return {
      titleKey: "onboarding.flow.learning_language.title",
      subtitleKey: "onboarding.flow.learning_language.subtitle",
      options: [
        { value: "en-US", label: t("learning.en_us"), icon: "chatbubble-ellipses-outline" },
        { value: "ja-JP", label: t("learning.ja_jp"), icon: "chatbubble-ellipses-outline" },
      ],
    };
  }
  if (step === 2) {
    return {
      titleKey: "onboarding.flow.difficulty.title",
      subtitleKey: "onboarding.flow.difficulty.subtitle",
      options: [
        {
          value: "simple",
          label: t("prompt_difficulty.simple"),
          detail: t("onboarding.flow.difficulty.simple_detail"),
          icon: "leaf-outline",
        },
        {
          value: "native",
          label: t("prompt_difficulty.native"),
          detail: t("onboarding.flow.difficulty.native_detail"),
          icon: "sparkles-outline",
        },
      ],
    };
  }
  return {
    titleKey: "onboarding.flow.source.title",
    subtitleKey: "onboarding.flow.source.subtitle",
    options: [
      { value: "youtube", label: "YouTube", icon: "logo-youtube" },
      { value: "xiaohongshu", label: "小红书", icon: "book-outline" },
      { value: "douyin", label: "抖音", icon: "musical-note-outline" },
      { value: "app_store", label: "App Store", icon: "logo-apple-appstore" },
      { value: "google_play", label: "Google Play", icon: "logo-google-playstore" },
    ],
  };
}

function selectedValue(step: PreLoginOnboardingStep, draft: PreLoginOnboardingDraft): string | undefined {
  if (step === 0) return draft.appLocale;
  if (step === 1) return draft.learningLanguage;
  if (step === 2) return draft.promptDifficulty;
  return draft.acquisitionSource;
}

function updateDraft(
  step: PreLoginOnboardingStep,
  draft: PreLoginOnboardingDraft,
  value: string,
): PreLoginOnboardingDraft {
  if (step === 0) return { ...draft, appLocale: value as AppLocale };
  if (step === 1) return { ...draft, learningLanguage: value as LearningLanguage };
  if (step === 2) return { ...draft, promptDifficulty: value as PromptDifficulty };
  return { ...draft, acquisitionSource: value as AcquisitionSource };
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.canvas },
  header: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSide: { width: 44, minHeight: 44, justifyContent: "center" },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -10 },
  progressText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: "600" },
  progressTrack: { flexDirection: "row", gap: 7, paddingHorizontal: 24, marginTop: 4 },
  progressSegment: { flex: 1, height: 3, borderRadius: 999, backgroundColor: "#E8E8E8" },
  progressSegmentActive: { backgroundColor: theme.colors.accentStrong },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 46, paddingBottom: 24 },
  eyebrow: { color: theme.colors.success, fontSize: 14, lineHeight: 20, fontWeight: "800", letterSpacing: 1.8 },
  title: { marginTop: 12, color: theme.colors.text, fontSize: 30, lineHeight: 39, fontWeight: "700" },
  subtitle: { marginTop: 10, color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23 },
  options: { marginTop: 34, gap: 12 },
  option: {
    minHeight: 68,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    flexDirection: "row",
    alignItems: "center",
  },
  optionActive: { borderColor: theme.colors.accentStrong, backgroundColor: "#F6F6F3" },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceMuted,
  },
  optionIconActive: { backgroundColor: theme.colors.accentStrong },
  optionCopy: { flex: 1, paddingHorizontal: 13 },
  optionLabel: { color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  optionLabelActive: { fontWeight: "700" },
  optionDetail: { marginTop: 3, color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: "#C9C9C9", alignItems: "center", justifyContent: "center" },
  radioActive: { borderColor: theme.colors.accentStrong },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.accentStrong },
  footer: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  continueButton: {
    height: 54,
    borderRadius: 18,
    backgroundColor: theme.colors.accentStrong,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  continueButtonDisabled: { opacity: 0.28 },
  continueText: { color: "#FFFFFF", fontSize: 16, lineHeight: 22, fontWeight: "700" },
});
