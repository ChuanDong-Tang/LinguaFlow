import { Alert } from "react-native";
import type { AutoCopyMode } from "../preferences/assistantPreferences";
import { copyTextToClipboard } from "../device/clipboardService";
import type { ChatContactId } from "../../domain/chat/contacts";
import { parseTaggedRewrite } from "../../domain/rewrite/taggedRewrite";

export async function copyAssistantText(text: string, silent = false): Promise<void> {
  try {
    const ok = await copyTextToClipboard(text);
    if (!ok && !silent) {
      Alert.alert("没有可复制的内容");
    }
  } catch {
    Alert.alert("复制失败", "请稍后重试，或手动选择内容复制。");
  }
}

export async function copyAssistantTaggedText(
  text: string,
  mode: AutoCopyMode,
  silent = false,
  contactId: ChatContactId = "rewrite_assistant",
): Promise<void> {
  const tagged = parseTaggedRewrite(text);
  const en = tagged.en.trim();
  const zh = contactId === "english_friend"
    ? tagged.reply.trim()
    : tagged.zh.trim();
  const copyText =
    mode === "en"
      ? en
      : mode === "zh"
        ? zh
        : [en, zh].filter(Boolean).join("\n");
  await copyAssistantText(copyText || text, silent);
}
