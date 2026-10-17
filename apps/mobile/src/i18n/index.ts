import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager, Platform, Settings } from "react-native";
import { resolveDeviceLanguage } from "./deviceLanguage";
import { messages, type SupportedLanguage, type TranslationKey } from "./messages";
export type { SupportedLanguage, TranslationKey } from "./messages";

const LANGUAGE_KEY = "lf_i18n_language";
const DEFAULT_LANGUAGE: SupportedLanguage = "en-US";

let currentLanguage: SupportedLanguage = DEFAULT_LANGUAGE;

export function useSystemLanguage(): SupportedLanguage {
  let locale: unknown;
  try {
    if (Platform.OS === "ios") {
      const languages = Settings.get("AppleLanguages");
      locale = Array.isArray(languages) ? languages[0] : undefined;
      locale = locale || Settings.get("AppleLocale");
    } else if (Platform.OS === "android") {
      locale = I18nManager.getConstants().localeIdentifier;
    }
    locale = locale || Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    // Unsupported or unavailable device locale falls back to English.
  }
  currentLanguage = resolveDeviceLanguage(locale);
  return currentLanguage;
}

/** Guest startup follows the device without overwriting the account preference. */
export async function initI18n(): Promise<SupportedLanguage> {
  return useSystemLanguage();
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
