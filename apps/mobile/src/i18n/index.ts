import AsyncStorage from "@react-native-async-storage/async-storage";
import { messages, type SupportedLanguage, type TranslationKey } from "./messages";
export type { SupportedLanguage, TranslationKey } from "./messages";

const LANGUAGE_KEY = "lf_i18n_language";
const DEFAULT_LANGUAGE: SupportedLanguage = "zh-CN";

let currentLanguage: SupportedLanguage = DEFAULT_LANGUAGE;

/** 初始化语言：启动时调用，优先使用本地已保存的用户语言。 */
export async function initI18n(): Promise<SupportedLanguage> {
  const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
  const normalized = normalizeLanguage(saved);
  if (normalized) {
    currentLanguage = normalized;
    return currentLanguage;
  }
  return currentLanguage;
}

export async function getSavedLanguage(): Promise<SupportedLanguage | null> {
  return normalizeLanguage(await AsyncStorage.getItem(LANGUAGE_KEY));
}

/** 获取当前语言。 */
export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

/** 设置语言并持久化到本地。 */
export async function setLanguage(language: SupportedLanguage): Promise<void> {
  currentLanguage = language;
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
}

/** 文案翻译函数：优先当前语言，缺失时回退到中文。 */
export function t(key: TranslationKey): string {
  return messages[currentLanguage][key] ?? messages["zh-CN"][key] ?? key;
}

export function tf(key: TranslationKey, params: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

function normalizeLanguage(value: string | null): SupportedLanguage | null {
  if (value === "zh-CN" || value === "zh-TW" || value === "en-US" || value === "ja-JP") {
    return value;
  }
  if (value === "en") return "en-US";
  return null;
}
