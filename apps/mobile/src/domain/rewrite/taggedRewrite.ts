export type TaggedRewriteParts = {
  rewrite: string;
  note: string;
  en: string;
  ja: string;
  zh: string;
  reply: string;
};

const DEFAULT_REWRITE_TAGS = ["rewrite", "note", "en", "ja", "jp", "zh", "cn", "reply"] as const;

// 前端只把 <en></en> 中间的内容当作“可展示/可挖空”的英文正文。
// <zh></zh> 只做辅助中文展示，不参与 token 索引和练习判定。
// 好奇宝宝使用 <en></en> 表示用户原话的自然英文改写，<reply></reply> 表示 AI 回复。
export function parseTaggedRewrite(text: string): TaggedRewriteParts {
  const parts = parseTaggedParts(text, DEFAULT_REWRITE_TAGS);
  const rewrite = parts.rewrite.trim();
  const note = parts.note.trim();
  const en = parts.en.trim();
  const ja = parts.ja.trim() || parts.jp.trim();
  const zh = parts.zh.trim() || parts.cn.trim();
  const reply = parts.reply.trim();
  const fallback = hasAnyTag(text, DEFAULT_REWRITE_TAGS) ? "" : stripKnownTags(text, DEFAULT_REWRITE_TAGS).trim();
  return {
    rewrite: rewrite || en || ja || fallback,
    note: note || zh,
    en,
    ja,
    zh,
    reply,
  };
}

// 通用标签解析：支持完整闭合标签，也支持流式输出里只有开标签、闭标签尚未到达的状态。
export function parseTaggedParts<const T extends readonly string[]>(
  text: string,
  tags: T,
): Record<T[number], string> {
  const result = Object.fromEntries(tags.map((tag) => [tag, ""])) as Record<T[number], string>;
  for (const tag of tags) {
    result[tag as T[number]] = extractTag(text, tag) || extractOpenTagText(text, tag, tags);
  }
  return result;
}

/** 旧消息可能没有标签；这里保持兼容，避免历史消息变成空白。 */
export function getRewriteEnglish(text: string): string {
  return parseTaggedRewrite(text).rewrite;
}

export function getRewriteChinese(text: string): string {
  return parseTaggedRewrite(text).note;
}

export function getCuriousReply(text: string): string {
  return parseTaggedRewrite(text).reply;
}

function extractTag(text: string, tag: string): string {
  const safeTag = escapeRegExp(tag);
  const match = new RegExp(`<${safeTag}>\\s*([\\s\\S]*?)\\s*<\\/${safeTag}>`, "i").exec(text);
  return match?.[1] ?? "";
}

function extractOpenTagText(text: string, tag: string, tags: readonly string[]): string {
  const startMatch = new RegExp(`<${escapeRegExp(tag)}>\\s*`, "i").exec(text);
  if (!startMatch) return "";
  const start = startMatch.index + startMatch[0].length;
  const rest = text.slice(start);
  const nextKnownTag = rest.search(createKnownTagPattern(tags));
  return nextKnownTag >= 0 ? rest.slice(0, nextKnownTag) : rest;
}

function stripKnownTags(text: string, tags: readonly string[]): string {
  return text.replace(createKnownTagPattern(tags, "gi"), "");
}

function hasAnyTag(text: string, tags: readonly string[]): boolean {
  return createKnownTagPattern(tags).test(text);
}

function createKnownTagPattern(tags: readonly string[], flags = "i"): RegExp {
  const source = tags.map(escapeRegExp).join("|");
  return new RegExp(`<\\/?(${source})>`, flags);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
