export type TaggedRewriteParts = {
  en: string;
  zh: string;
  reply: string;
};

// 前端只把 <en></en> 中间的内容当作“可展示/可挖空”的英文正文。
// <zh></zh> 只做辅助中文展示，不参与 token 索引和练习判定。
// 好奇宝宝使用 <en></en> 表示用户原话的自然英文改写，<reply></reply> 表示 AI 回复。
export function parseTaggedRewrite(text: string): TaggedRewriteParts {
  const en = extractTag(text, "en").trim() || extractOpenTagText(text, "en").trim();
  const zh = extractTag(text, "zh").trim() || extractTag(text, "cn").trim();
  const reply = extractTag(text, "reply").trim() || extractOpenTagText(text, "reply").trim();
  const hasKnownTag = /<\/?(en|zh|cn|reply)>/i.test(text);
  return {
    en: en || (hasKnownTag ? "" : stripKnownTags(text).trim()),
    zh,
    reply,
  };
}

/** 旧消息可能没有标签；这里保持兼容，避免历史消息变成空白。 */
export function getRewriteEnglish(text: string): string {
  return parseTaggedRewrite(text).en;
}

export function getRewriteChinese(text: string): string {
  return parseTaggedRewrite(text).zh;
}

export function getCuriousReply(text: string): string {
  return parseTaggedRewrite(text).reply;
}

function extractTag(text: string, tag: "en" | "zh" | "cn" | "reply"): string {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i").exec(text);
  return match?.[1] ?? "";
}

function extractOpenTagText(text: string, tag: "en" | "zh" | "cn" | "reply"): string {
  const startMatch = new RegExp(`<${tag}>\\s*`, "i").exec(text);
  if (!startMatch) return "";
  const start = startMatch.index + startMatch[0].length;
  const rest = text.slice(start);
  const nextKnownTag = rest.search(/<\/?(en|zh|cn|reply)>/i);
  return nextKnownTag >= 0 ? rest.slice(0, nextKnownTag) : rest;
}

function stripKnownTags(text: string): string {
  return text
    .replace(/<\/?en>/gi, "")
    .replace(/<\/?zh>/gi, "")
    .replace(/<\/?cn>/gi, "")
    .replace(/<\/?reply>/gi, "");
}
