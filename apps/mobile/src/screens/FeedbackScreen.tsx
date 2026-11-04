import React, { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { Text, TextInput } from "../components/Typography";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Application from "expo-application";
import { SafeAreaView } from "react-native-safe-area-context";
import { getLanguage, t } from "../i18n";
import { submitFeedback, type FeedbackCategory } from "../services/api/meApi";
import { theme } from "../theme";

type FeedbackScreenProps = {
  onBack: () => void;
};

const CATEGORY_OPTIONS: Array<{
  value: FeedbackCategory;
  label: Parameters<typeof t>[0];
}> = [
  { value: "suggestion", label: "feedback.category.suggestion" },
  { value: "problem", label: "feedback.category.problem" },
  { value: "other", label: "feedback.category.other" },
];

export function FeedbackScreen({ onBack }: FeedbackScreenProps) {
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const normalizedContent = content.trim();
  const canSubmit = normalizedContent.length >= 2 && !submitting;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitFeedback({
        category,
        content: normalizedContent,
        platform: Platform.OS,
        appVersion: Application.nativeApplicationVersion,
        buildNumber: Application.nativeBuildVersion,
        osVersion: String(Platform.Version),
        appLocale: getLanguage(),
      });
      Alert.alert(t("feedback.success.title"), t("feedback.success.message"), [
        { text: t("feedback.success.done"), onPress: onBack },
      ]);
    } catch (error) {
      Alert.alert(
        t("feedback.error.title"),
        error instanceof Error ? error.message : t("feedback.error.message"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={onBack} hitSlop={10} disabled={submitting}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("feedback.title")}</Text>
        <View style={styles.headerButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={styles.intro}>{t("feedback.intro")}</Text>

        <View style={styles.categories}>
          {CATEGORY_OPTIONS.map((option) => {
            const selected = option.value === category;
            return (
              <Pressable
                key={option.value}
                style={[styles.category, selected && styles.categorySelected]}
                onPress={() => setCategory(option.value)}
                disabled={submitting}
              >
                <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                  {t(option.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.inputCard}>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder={t("feedback.placeholder")}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={2_000}
            textAlignVertical="top"
            autoFocus
            editable={!submitting}
            style={styles.input}
          />
          <Text style={styles.counter}>{content.length}/2000</Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            !canSubmit && styles.submitButtonDisabled,
            pressed && canSubmit && styles.submitButtonPressed,
          ]}
          onPress={() => void handleSubmit()}
          disabled={!canSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text style={styles.submitText}>{t("feedback.submit")}</Text>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.canvas },
  header: {
    height: 60,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "500" },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 16 },
  intro: { color: theme.colors.textStrong, fontSize: 14, lineHeight: 22, marginBottom: 18 },
  categories: { flexDirection: "row", gap: 8, marginBottom: 14 },
  category: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
  },
  categorySelected: { borderColor: theme.colors.text, backgroundColor: theme.colors.ink },
  categoryText: { color: theme.colors.textStrong, fontSize: 13 },
  categoryTextSelected: { color: theme.colors.onAccent },
  inputCard: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    padding: 14,
  },
  input: { flex: 1, minHeight: 170, padding: 0, color: theme.colors.text, fontSize: 15, lineHeight: 23 },
  counter: { marginTop: 8, color: theme.colors.textMuted, fontSize: 12, textAlign: "right" },
  submitButton: {
    minHeight: 48,
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: theme.colors.ink,
  },
  submitButtonDisabled: { backgroundColor: theme.colors.disabled },
  submitButtonPressed: { opacity: 0.78 },
  submitText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "600" },
});
