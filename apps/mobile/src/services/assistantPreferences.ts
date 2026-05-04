import AsyncStorage from "@react-native-async-storage/async-storage";

const ASSISTANT_PREFERENCES_KEY = "linguaflow.assistant.preferences.v1";

export type AssistantPreferences = {
  autoCopyAfterRewrite: boolean;
};

const DEFAULT_PREFERENCES: AssistantPreferences = {
  autoCopyAfterRewrite: true,
};

export async function loadAssistantPreferences(): Promise<AssistantPreferences> {
  const raw = await AsyncStorage.getItem(ASSISTANT_PREFERENCES_KEY);
  if (!raw) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<AssistantPreferences>;
    return {
      autoCopyAfterRewrite:
        typeof parsed.autoCopyAfterRewrite === "boolean"
          ? parsed.autoCopyAfterRewrite
          : DEFAULT_PREFERENCES.autoCopyAfterRewrite,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveAssistantPreferences(preferences: AssistantPreferences): Promise<void> {
  await AsyncStorage.setItem(ASSISTANT_PREFERENCES_KEY, JSON.stringify(preferences));
}

