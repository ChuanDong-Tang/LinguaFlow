import AsyncStorage from "@react-native-async-storage/async-storage";

const DEBUG_SETTINGS_KEY = "linguaflow.debug.settings.v1";

export type DebugModelProvider = "deepseek" | "kimi" | "xunfei";

export type DebugSettings = {
  systemPrompt: string;
  modelProvider: DebugModelProvider;
};

const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  systemPrompt: "",
  modelProvider: "deepseek",
};

export async function loadDebugSettings(): Promise<DebugSettings> {
  const raw = await AsyncStorage.getItem(DEBUG_SETTINGS_KEY);
  if (!raw) return DEFAULT_DEBUG_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<DebugSettings>;
    return {
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : "",
      modelProvider: isDebugModelProvider(parsed.modelProvider) ? parsed.modelProvider : "deepseek",
    };
  } catch {
    return DEFAULT_DEBUG_SETTINGS;
  }
}

export async function saveDebugSettings(settings: DebugSettings): Promise<void> {
  await AsyncStorage.setItem(DEBUG_SETTINGS_KEY, JSON.stringify(settings));
}

function isDebugModelProvider(value: unknown): value is DebugModelProvider {
  return value === "deepseek" || value === "kimi" || value === "xunfei";
}
