import { Alert } from "react-native";
import type { AutoCopyMode } from "../preferences/assistantPreferences";
import { copyTextToClipboard } from "../device/clipboardService";
import { getRewriteChinese, getRewriteEnglish } from "../../domain/rewrite/taggedRewrite";

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
  silent = false
): Promise<void> {
  const en = getRewriteEnglish(text).trim();
  const zh = getRewriteChinese(text).trim();
  const copyText =
    mode === "en"
      ? en
      : mode === "zh"
        ? zh
        : [en, zh].filter(Boolean).join("\n");
  await copyAssistantText(copyText || text, silent);
}
