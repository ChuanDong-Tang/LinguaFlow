import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

export type Locale = "en" | "zh-CN";
export type MessageKey = keyof typeof en;

const dictionaries: Record<Locale, typeof en> = {
  en,
  "zh-CN": zhCN,
};

class I18nService {
  private locale: Locale = "en";
  private listeners = new Set<(locale: Locale) => void>();

  constructor() {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("oio-locale");
      if (stored === "en" || stored === "zh-CN") {
        this.locale = stored;
      }
    }
  }

  getLocale(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale): void {
    if (this.locale === locale) return;
    this.locale = locale;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("oio-locale", locale);
    }
    for (const listener of this.listeners) {
      listener(locale);
    }
  }

  t(key: MessageKey): string {
    return dictionaries[this.locale][key] ?? dictionaries.en[key] ?? key;
  }

  subscribe(listener: (locale: Locale) => void): () => void {
    this.listeners.add(listener);
    listener(this.locale);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const i18n = new I18nService();

export function getI18n(): I18nService {
  return i18n;
}

export function t(key: MessageKey): string {
  return i18n.t(key);
}
