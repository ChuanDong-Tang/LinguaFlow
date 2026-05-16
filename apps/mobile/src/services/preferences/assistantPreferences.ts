import AsyncStorage from "@react-native-async-storage/async-storage";

const ASSISTANT_PREFERENCES_KEY = "linguaflow.assistant.preferences.v1";

export type AutoCopyMode = "en" | "zh" | "both";

export type AssistantPreferences = {
  autoCopyAfterRewrite: boolean;
  autoCopyMode: AutoCopyMode;
};

const DEFAULT_PREFERENCES: AssistantPreferences = {
  autoCopyAfterRewrite: true,
  autoCopyMode: "en",
};

export async function loadAssistantPreferences(): Promise<AssistantPreferences> {
  const raw = await AsyncStorage.getItem(ASSISTANT_PREFERENCES_KEY);
  if (!raw) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<AssistantPreferences>;
    const legacyAutoCopy = typeof parsed.autoCopyAfterRewrite === "boolean"
      ? parsed.autoCopyAfterRewrite
      : DEFAULT_PREFERENCES.autoCopyAfterRewrite;
    return {
      autoCopyAfterRewrite: legacyAutoCopy,
      autoCopyMode: isAutoCopyMode(parsed.autoCopyMode)
        ? parsed.autoCopyMode
        : legacyAutoCopy
          ? DEFAULT_PREFERENCES.autoCopyMode
          : "en",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveAssistantPreferences(preferences: AssistantPreferences): Promise<void> {
  await AsyncStorage.setItem(ASSISTANT_PREFERENCES_KEY, JSON.stringify(preferences));
}

function isAutoCopyMode(value: unknown): value is AutoCopyMode {
  return value === "en" || value === "zh" || value === "both";
}
