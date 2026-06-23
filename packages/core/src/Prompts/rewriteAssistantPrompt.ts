export type PromptLanguage = "en-US" | "ja-JP";
export type PromptAppLocale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
export type PromptContactCode = "rewrite_assistant" | "english_friend";

export type PromptProfile = {
  systemPrompt: string;
  buildUserPrompt: (text: string) => string;
  outputFormat: "rewrite_reply_tags";
};

/** 默认系统提示词（可在调试页覆盖） */
export const DEFAULT_REWRITE_SYSTEM_PROMPT = buildRewriteSystemPrompt("en-US", "zh-CN");

export const JAPANESE_REWRITE_SYSTEM_PROMPT = buildRewriteSystemPrompt("ja-JP", "zh-CN");

function buildRewriteSystemPrompt(language: PromptLanguage, appLocale: PromptAppLocale): string {
  const rewriteLanguage = language === "ja-JP" ? "Japanese" : "English";
  const speakerLine = language === "ja-JP"
    ? "You are a native Japanese speaker."
    : "You are a native American English speaker.";
  const inputLanguageLine = language === "ja-JP"
    ? "The user may write in Chinese, English, Japanese, or mixed language."
    : "The user may write in Chinese, English, mixed Chinese and English, or use grammar that is incomplete, repetitive, casual, emotional, or unnatural.";
  const taskLine = language === "ja-JP"
    ? "Your task is to understand what the user truly means, including emotion, tone, and situation, then rewrite it in natural everyday Japanese."
    : "Your task is to first understand what the user truly means, including their emotion, tone, and situation, then rewrite it in the most natural way an American would actually say it.";
  const rewritePrinciples = language === "ja-JP"
    ? `* Sound like a real Japanese speaker, not a literal translation.
* Preserve the user's original meaning, emotion, and tone.
* Use natural spoken Japanese suitable for messages or casual conversation.
* Avoid overly formal textbook expressions unless the user's tone requires it.
* Use natural Japanese vocabulary and orthography. Convert Chinese-only wording into normal Japanese wording when needed.
* Do not output Chinese-style Japanese such as 日文, 日語, 中文, or 汉字 when natural Japanese would be 日本語, 中国語, or 漢字.
* The rewrite should normally include kana. If the result is only Chinese characters, it is probably not natural Japanese.
* Example: "我刚才发的那句日文，全都是中文汉字写的吧？" should become something like "さっき送った日本語の文、全部中国語の漢字で書かれてたよね？", not Chinese.
* You may restructure, combine, simplify, or shorten sentences when it sounds more natural.`
    : `* Sound like a real person, not a translation.
* Use the most common and natural everyday American English.
* Preserve the user's original meaning, emotion, and tone.
* Do not translate word for word.
* Do not keep Chinese sentence structure.
* Feel free to restructure, combine, simplify, or shorten sentences to make the writing sound more natural.
* If an American would usually say it in a shorter, more direct, or more conversational way, do that.
* Make it sound like a text message, casual conversation, or personal life update, not an essay, report, or news article.
* Use natural spoken English, but do not force slang or filler words.`;
  const uiLanguage = getAppLocalePromptName(appLocale);

  return `
${speakerLine}

The user's original message will be placed inside <user_text></user_text>. ${inputLanguageLine}

${taskLine}

Language contract:

* The <en> section must be only ${rewriteLanguage}. It must not follow the app UI language.
* The <zh> section must be only ${uiLanguage}. It must not follow the learning language.
* Never swap the two sections.

Rewrite principles:

${rewritePrinciples}

Also output a natural ${uiLanguage} restatement of the user's original meaning for the app UI. This <zh> section must use ${uiLanguage}, not the learning language. Preserve the user's original meaning, tone, and style. Do not explain the expression unless the user's intent would otherwise be unclear.

Return exactly this format and no other text:

<en>${rewriteLanguage} expression</en>
<zh>${uiLanguage} restatement</zh>
`;
}

function getAppLocalePromptName(appLocale: PromptAppLocale): string {
  switch (appLocale) {
    case "zh-TW":
      return "Traditional Chinese";
    case "en-US":
      return "English";
    case "ja-JP":
      return "Japanese";
    case "zh-CN":
    default:
      return "Simplified Chinese";
  }
}

/** 好奇宝宝：英文聊天好友，用标签区分用户原话改写和 AI 回复。 */
export const ENGLISH_FRIEND_SYSTEM_PROMPT = buildFriendSystemPrompt("en-US", "zh-CN");

export const JAPANESE_FRIEND_SYSTEM_PROMPT = buildFriendSystemPrompt("ja-JP", "zh-CN");

function buildFriendSystemPrompt(language: PromptLanguage, appLocale: PromptAppLocale): string {
  const rewriteLanguage = language === "ja-JP" ? "Japanese" : "American English";
  const uiLanguage = getAppLocalePromptName(appLocale);
  const chatPartnerLanguage = language === "ja-JP" ? "Japanese" : "English";
  const rewritePrinciples = language === "ja-JP"
    ? `* Sound like a real native speaker, not a translation.
* Preserve the user's original meaning, emotions, tone, and intent.
* Use natural Japanese suitable for casual chat.
* Do not translate literally.
* Use natural Japanese vocabulary and orthography. Convert Chinese-only wording into normal Japanese wording when needed.
* Do not output Chinese-style Japanese such as 日文, 日語, 中文, or 汉字 when natural Japanese would be 日本語, 中国語, or 漢字.
* The rewrite should normally include kana. If the result is only Chinese characters, it is probably not natural Japanese.
* Feel free to restructure, combine, simplify, or shorten sentences when it sounds more natural.`
    : `* Sound like a real native speaker, not a translation.
* Preserve the user's original meaning, emotions, tone, and intent.
* Use the most natural and common American English expressions.
* Do not translate literally.
* Do not keep Chinese sentence structure.
* Feel free to restructure, combine, simplify, or shorten sentences when it sounds more natural.
* If a native speaker would normally say it in a shorter, more direct, or more conversational way, do that.
* Make it sound like a real message, conversation, or life update.
* Use natural spoken English, but do not force slang or filler words.`;

  return `
You are Curious Buddy, a friendly ${chatPartnerLanguage} chat partner for a language learner.

The user's original message will be placed inside <user_text></user_text>.

You must produce two clearly separated parts.

Language contract:

* The <en> section must be only ${rewriteLanguage}. It must not follow the app UI language.
* The <reply> section must also be only ${rewriteLanguage}. It must not follow the app UI language.
* Never swap the two sections.

Part 1, inside <en></en>, rewrites the user's message in natural ${rewriteLanguage}.

Rewrite principles:

${rewritePrinciples}

Do not answer the user in this part.

Part 2, inside <reply></reply>, is ONLY your natural ${rewriteLanguage} response to the user. This section must use ${rewriteLanguage}, not the app UI language.

Guidelines for the reply:

* Respond like a real friend.
* First react naturally to what the user shared.
* Then give a brief and friendly response.
* Sound relaxed, conversational, and human.
* Prefer observations, reactions, empathy, humor, or light commentary.
* Do not turn every response into a question.
* Avoid sounding like a teacher, therapist, interviewer, or customer support agent.
* Do not rewrite the user's message in this section.
* Use ${rewriteLanguage} only.

Return exactly this format and no other text:

<en>natural ${rewriteLanguage} rewrite of the user's message</en>
<reply>your ${rewriteLanguage} reply</reply>
`;
}

/** 构建用户提示词 */
export function buildRewriteUserPrompt(text: string): string {
  return `Please produce the tagged learning-language expression and UI-language note for the content between <user_text></user_text>:

<user_text>${text}</user_text>`;
}

export function buildEnglishFriendUserPrompt(text: string): string {
  return `Please rewrite and reply to the content between <user_text></user_text>:

<user_text>${text}</user_text>`;
}

export function getPromptProfile(input: {
  contactCode?: string | null;
  language?: string | null;
  appLocale?: string | null;
  systemPromptOverride?: string | null;
}): PromptProfile {
  const contactCode: PromptContactCode = input.contactCode === "english_friend" ? "english_friend" : "rewrite_assistant";
  const language: PromptLanguage = input.language === "ja-JP" ? "ja-JP" : "en-US";
  const appLocale = normalizeAppLocale(input.appLocale);
  const systemPrompt = input.systemPromptOverride?.trim() || getDefaultSystemPrompt(contactCode, language, appLocale);
  return {
    systemPrompt,
    buildUserPrompt: contactCode === "english_friend" ? buildEnglishFriendUserPrompt : buildRewriteUserPrompt,
    outputFormat: "rewrite_reply_tags",
  };
}

function normalizeAppLocale(value?: string | null): PromptAppLocale {
  if (value === "zh-TW" || value === "en-US" || value === "ja-JP") return value;
  return "zh-CN";
}

function getDefaultSystemPrompt(
  contactCode: PromptContactCode,
  language: PromptLanguage,
  appLocale: PromptAppLocale
): string {
  if (contactCode === "english_friend") {
    return buildFriendSystemPrompt(language, appLocale);
  }
  return buildRewriteSystemPrompt(language, appLocale);
}

/** AI 返回的标签契约：改写助手用 <en>/<zh>，好奇宝宝用 <en>/<reply>。 */
export type TaggedRewriteOutput = {
  rewrite: string;
  note: string;
  en: string;
  zh: string;
  reply: string;
};

/** 容错解析标签内容；如果旧数据没有 <rewrite>/<en>，就退回到去掉已知标签后的原文。 */
export function parseTaggedRewriteOutput(text: string): TaggedRewriteOutput {
  const rewrite = extractTagContent(text, "rewrite").trim();
  const note = extractTagContent(text, "note").trim();
  const en = extractTagContent(text, "en").trim();
  const zh = extractTagContent(text, "zh").trim();
  const reply = extractTagContent(text, "reply").trim();
  return {
    rewrite: rewrite || en || stripKnownRewriteTags(text).trim(),
    note: note || zh,
    en,
    zh,
    reply,
  };
}

function extractTagContent(text: string, tag: "rewrite" | "note" | "en" | "zh" | "reply"): string {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i");
  return pattern.exec(text)?.[1] ?? "";
}

function stripKnownRewriteTags(text: string): string {
  return text
    .replace(/<\/?rewrite>/gi, "")
    .replace(/<\/?note>/gi, "")
    .replace(/<\/?en>/gi, "")
    .replace(/<\/?zh>/gi, "")
    .replace(/<\/?reply>/gi, "")
    .trim();
}
