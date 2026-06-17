import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatContactId } from "../../domain/chat/contacts";

const DEBUG_SETTINGS_KEY = "linguaflow.debug.settings.v1";

export type DebugSettings = {
  systemPromptsByContactId: Partial<Record<ChatContactId, string>>;
  provider: string;
  model: string;
};

const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  systemPromptsByContactId: {},
  provider: "",
  model: "",
};

export async function loadDebugSettings(): Promise<DebugSettings> {
  const raw = await AsyncStorage.getItem(DEBUG_SETTINGS_KEY);
  if (!raw) return DEFAULT_DEBUG_SETTINGS;

  try {
    const parsed = JSON.parse(raw) as Partial<DebugSettings>;
    const promptMap = typeof parsed.systemPromptsByContactId === "object" && parsed.systemPromptsByContactId
      ? normalizePromptMap(parsed.systemPromptsByContactId)
      : {};
    return {
      systemPromptsByContactId: promptMap,
      provider: typeof parsed.provider === "string" ? parsed.provider : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return DEFAULT_DEBUG_SETTINGS;
  }
}

export async function saveDebugSettings(settings: DebugSettings): Promise<void> {
  await AsyncStorage.setItem(DEBUG_SETTINGS_KEY, JSON.stringify(settings));
}

function normalizePromptMap(value: object): Partial<Record<ChatContactId, string>> {
  const record = value as Record<string, unknown>;
  return {
    rewrite_assistant: typeof record.rewrite_assistant === "string" ? record.rewrite_assistant : "",
    english_friend: typeof record.english_friend === "string" ? record.english_friend : "",
  };
}
