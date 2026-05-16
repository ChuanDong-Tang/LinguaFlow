export type TaggedRewriteParts = {
  en: string;
  zh: string;
};

// 前端只把 <en></en> 中间的内容当作“可展示/可挖空”的英文正文。
// <zh></zh> 只做辅助中文展示，不参与 token 索引和练习判定。
export function parseTaggedRewrite(text: string): TaggedRewriteParts {
  const en = extractTag(text, "en").trim();
  const zh = extractTag(text, "zh").trim();
  return {
    en: en || stripKnownTags(text).trim(),
    zh,
  };
}

/** 旧消息可能没有标签；这里保持兼容，避免历史消息变成空白。 */
export function getRewriteEnglish(text: string): string {
  return parseTaggedRewrite(text).en;
}

export function getRewriteChinese(text: string): string {
  return parseTaggedRewrite(text).zh;
}

function extractTag(text: string, tag: "en" | "zh"): string {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i").exec(text);
  return match?.[1] ?? "";
}

function stripKnownTags(text: string): string {
  return text.replace(/<\/?en>/gi, "").replace(/<\/?zh>/gi, "");
}
