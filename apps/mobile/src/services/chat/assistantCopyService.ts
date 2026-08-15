import { Alert } from "react-native";
import type { AutoCopyMode } from "../preferences/assistantPreferences";
import { copyTextToClipboard } from "../device/clipboardService";
import { parseTaggedRewrite } from "../../domain/rewrite/taggedRewrite";
import { t } from "../../i18n";

export async function copyAssistantText(text: string, silent = false): Promise<boolean> {
  try {
    const ok = await copyTextToClipboard(text);
    if (!ok && !silent) {
      Alert.alert(t("common.copy.empty"));
    }
    return ok;
  } catch {
    Alert.alert(t("common.copy.failed_title"), t("common.copy.failed_message"));
    return false;
  }
}

export async function copyAssistantTaggedText(
  text: string,
  mode: AutoCopyMode,
  silent = false,
): Promise<boolean> {
  const tagged = parseTaggedRewrite(text);
  const rewrite = (tagged.rewrite || tagged.en || tagged.ja).trim();
  const note = (tagged.note || tagged.zh).trim();
  const reply = tagged.reply.trim();
  const copyText =
    mode === "rewrite"
      ? rewrite
      : mode === "note"
        ? note
        : mode === "reply"
          ? reply
          : mode === "all"
            ? [rewrite, note, reply].filter(Boolean).join("\n")
            : "";
  return copyAssistantText(copyText, silent);
}
