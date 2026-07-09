import AsyncStorage from "@react-native-async-storage/async-storage";

const ASSISTANT_PREFERENCES_KEY = "linguaflow.assistant.preferences.v1";

export type AutoCopyMode = "none" | "rewrite" | "note" | "reply" | "all";
export type CompanionMode = "rewrite_only" | "native_note" | "simple_reply";

export type AssistantPreferences = {
  autoCopyAfterGeneration: boolean;
  autoCopyMode: AutoCopyMode;
  companionModeByContactId: Record<string, CompanionMode>;
};

const DEFAULT_PREFERENCES: AssistantPreferences = {
  autoCopyAfterGeneration: false,
  autoCopyMode: "none",
  companionModeByContactId: {},
};

export async function loadAssistantPreferences(): Promise<AssistantPreferences> {
  const raw = await AsyncStorage.getItem(ASSISTANT_PREFERENCES_KEY);
  if (!raw) return DEFAULT_PREFERENCES;

  try {
    const parsed = JSON.parse(raw) as Partial<AssistantPreferences>;
    const rawMode = normalizeAutoCopyMode(parsed.autoCopyMode);
    const autoCopy = typeof parsed.autoCopyAfterGeneration === "boolean"
      ? parsed.autoCopyAfterGeneration
      : rawMode !== "none" && DEFAULT_PREFERENCES.autoCopyAfterGeneration;
    const autoCopyMode = autoCopy ? rawMode : "none";
    return {
      autoCopyAfterGeneration: autoCopy,
      autoCopyMode,
      companionModeByContactId: normalizeCompanionModeMap(parsed.companionModeByContactId),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function saveAssistantPreferences(preferences: AssistantPreferences): Promise<void> {
  await AsyncStorage.setItem(ASSISTANT_PREFERENCES_KEY, JSON.stringify(preferences));
}

function normalizeAutoCopyMode(value: unknown): AutoCopyMode {
  if (value === "rewrite" || value === "note" || value === "reply" || value === "all" || value === "none") return value;
  if (value === "en") return "rewrite";
  if (value === "zh") return "note";
  if (value === "both") return "all";
  return DEFAULT_PREFERENCES.autoCopyMode;
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
