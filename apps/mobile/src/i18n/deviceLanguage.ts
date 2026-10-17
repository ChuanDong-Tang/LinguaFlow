import type { SupportedLanguage } from "./messages";

/** Resolve the device's primary locale, not a previously selected account language. */
export function resolveDeviceLanguage(locale: unknown): SupportedLanguage {
  if (typeof locale !== "string") return "en-US";
  const parts = locale.toLowerCase().replace(/_/g, "-").split("-");
  if (parts[0] === "ja") return "ja-JP";
  if (parts[0] !== "zh") return "en-US";
  if (parts.includes("hant")) return "zh-TW";
  if (parts.includes("hans")) return "zh-CN";
  return parts.some((part) => ["tw", "hk", "mo"].includes(part)) ? "zh-TW" : "zh-CN";
}
