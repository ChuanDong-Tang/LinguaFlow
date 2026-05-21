import AsyncStorage from "@react-native-async-storage/async-storage";

const ASSISTANT_PREFERENCES_KEY = "linguaflow.assistant.preferences.v1";

export type AutoCopyMode = "en" | "zh" | "both";

export type AssistantPreferences = {
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
};

const DEFAULT_PREFERENCES: AssistantPreferences = {
  autoCopyAfterGeneration: true,
  autoCopyMode: "en",
};

export async function loadAssistantPreferences(): Promise<AssistantPreferences> {
  const raw = await AsyncStorage.getItem(ASSISTANT_PREFERENCES_KEY);
  if (!raw) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<AssistantPreferences>;
    const autoCopy = typeof parsed.autoCopyAfterGeneration === "boolean"
      ? parsed.autoCopyAfterGeneration
      : DEFAULT_PREFERENCES.autoCopyAfterGeneration;
    return {
      autoCopyAfterGeneration: autoCopy,
      autoCopyMode: isAutoCopyMode(parsed.autoCopyMode)
        ? parsed.autoCopyMode
        : autoCopy
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
