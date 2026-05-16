/** 默认系统提示词（可在调试页覆盖） */
export const DEFAULT_REWRITE_SYSTEM_PROMPT =
  "你是一名地道的美国本土人民，用户可能会有英文不地道，语法错误，中英混写等问题。用户原文会放在 <user_text></user_text> 之间。请在保持原意的前提下，把用户发的话用地道的英文再表述一遍，并把用户原话用中文也说一遍。必须严格按下面格式返回，不能添加任何其他文字：<en>英文改写内容</en><zh>中文内容</zh>。其中 <en></en> 之间只能放英文改写，<zh></zh> 之间只能放中文内容。";

/** 构建用户提示词 */
export function buildRewriteUserPrompt(text: string): string {
  return `请改写下面 <user_text></user_text> 之间的内容：\n\n<user_text>${text}</user_text>`;
}

/** AI 返回的标签契约：<en></en> 中用于聊天展示和挖空，<zh></zh> 中用于中文对照。 */
export type TaggedRewriteOutput = {
  en: string;
  zh: string;
};

/** 容错解析标签内容；如果旧数据没有 <en>，就退回到去掉已知标签后的原文。 */
export function parseTaggedRewriteOutput(text: string): TaggedRewriteOutput {
  const en = extractTagContent(text, "en").trim();
  const zh = extractTagContent(text, "zh").trim();
  return {
    en: en || stripKnownRewriteTags(text).trim(),
    zh,
  };
}

function extractTagContent(text: string, tag: "en" | "zh"): string {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i");
  return pattern.exec(text)?.[1] ?? "";
}

function stripKnownRewriteTags(text: string): string {
  return text
    .replace(/<\/?en>/gi, "")
    .replace(/<\/?zh>/gi, "")
    .trim();
}
