import AsyncStorage from "@react-native-async-storage/async-storage";

const ASSISTANT_PREFERENCES_KEY = "linguaflow.assistant.preferences.v1";

export type AutoCopyMode = "en" | "zh" | "both";
export type CompanionMode = "rewrite_only" | "native_note" | "simple_reply";

export type AssistantPreferences = {
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  companionModeByContactId: Record<string, CompanionMode>;
};

const DEFAULT_PREFERENCES: AssistantPreferences = {
  autoCopyAfterGeneration: true,
  autoCopyMode: "en",
  companionModeByContactId: {},
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
      companionModeByContactId: normalizeCompanionModeMap(parsed.companionModeByContactId),
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

function normalizeCompanionModeMap(value: unknown): Record<string, CompanionMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, CompanionMode> = {};
  for (const [key, mode] of Object.entries(value as Record<string, unknown>)) {
    if (key && isCompanionMode(mode)) output[key] = mode;
  }
  return output;
}

function isCompanionMode(value: unknown): value is CompanionMode {
  return value === "rewrite_only" || value === "native_note" || value === "simple_reply";
}
