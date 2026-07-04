import { Alert } from "react-native";
import type { AutoCopyMode } from "../preferences/assistantPreferences";
import { copyTextToClipboard } from "../device/clipboardService";
import type { ChatContactId } from "../../domain/chat/contacts";
import { parseTaggedRewrite } from "../../domain/rewrite/taggedRewrite";
import { t } from "../../i18n";

export async function copyAssistantText(text: string, silent = false): Promise<void> {
  try {
    const ok = await copyTextToClipboard(text);
    if (!ok && !silent) {
      Alert.alert(t("common.copy.empty"));
    }
  } catch {
    Alert.alert(t("common.copy.failed_title"), t("common.copy.failed_message"));
  }
}

export async function copyAssistantTaggedText(
  text: string,
  mode: AutoCopyMode,
  silent = false,
  contactId: ChatContactId = "rewrite_assistant",
): Promise<void> {
  const tagged = parseTaggedRewrite(text);
  const expression = (tagged.rewrite || tagged.en).trim();
  const note = contactId === "english_friend" || (contactId === "curious_companion" && tagged.reply.trim())
    ? tagged.reply.trim()
    : (tagged.note || tagged.zh).trim();
  const copyText =
    mode === "en"
      ? expression
      : mode === "zh"
        ? note
        : [expression, note].filter(Boolean).join("\n");
  await copyAssistantText(copyText, silent);
}
