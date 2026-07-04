import type { PromptAppLocale, PromptLanguage } from "./rewriteAssistantPrompt.js";

export type PromptDifficulty = "simple" | "natural" | "native";
export type PromptStyle = "native_casual" | "standard";

export const DEFAULT_PROMPT_DIFFICULTY: PromptDifficulty = "natural";
export const DEFAULT_PROMPT_STYLE: PromptStyle = "native_casual";

export function normalizePromptDifficulty(value?: string | null): PromptDifficulty {
  return value === "simple" || value === "native" ? value : DEFAULT_PROMPT_DIFFICULTY;
}

export function normalizePromptStyle(value?: string | null): PromptStyle {
  return value === "standard" ? "standard" : DEFAULT_PROMPT_STYLE;
}

export function buildPromptPreferenceInstructions(input: {
  language: PromptLanguage;
  appLocale: PromptAppLocale;
  difficulty?: PromptDifficulty | string | null;
  style?: PromptStyle | string | null;
  purpose: "rewrite" | "reply" | "dictionary";
}): string {
  const difficulty = normalizePromptDifficulty(input.difficulty);
  const style = normalizePromptStyle(input.style);
  const languageLine = input.language === "ja-JP"
    ? japaneseDifficultyLine(difficulty)
    : englishDifficultyLine(difficulty);
  const uiLine = uiDifficultyLine(input.appLocale, difficulty);
  const styleLine = input.language === "ja-JP"
    ? japaneseStyleLine(style)
    : englishStyleLine(style);
  const purposeLine = purposeLineFor(input.purpose);

  return `User expression preferences:
* Difficulty: ${difficulty}. ${languageLine}
* Style: ${style}. ${styleLine}
* UI explanation language: ${uiLine}
* ${purposeLine}
* Never make the output childish or robotic. Keep it useful and natural for a language learner.`;
}

function englishDifficultyLine(value: PromptDifficulty): string {
  if (value === "simple") {
    return "Use CEFR A1-A2 learner English. Prefer common 2,000-3,000 words, short sentences, and simple grammar.";
  }
  if (value === "native") {
    return "Use fluent everyday English for a stronger learner. Natural idioms and more precise wording are allowed when they fit.";
  }
  return "Use clear everyday English around CEFR B1-B2. Do not make it needlessly advanced.";
}

function japaneseDifficultyLine(value: PromptDifficulty): string {
  if (value === "simple") {
    return "Use beginner Japanese around JLPT N5-N4. Prefer short sentences, common words, simple grammar, and avoid rare kanji.";
  }
  if (value === "native") {
    return "Use fluent everyday Japanese for a stronger learner. Natural contractions, common idioms, and more precise wording are allowed when they fit.";
  }
  return "Use clear everyday Japanese around JLPT N4-N3. Keep it natural without making it needlessly advanced.";
}

function uiDifficultyLine(appLocale: PromptAppLocale, value: PromptDifficulty): string {
  if (appLocale === "en-US") return englishDifficultyLine(value);
  if (appLocale === "ja-JP") return japaneseDifficultyLine(value);
  if (value === "native") return "Use precise but still readable everyday Chinese.";
  if (value === "simple") return "Use simple everyday Chinese. Avoid idioms, literary wording, technical jargon, and long sentences.";
  return "Use clear, natural everyday Chinese.";
}

function englishStyleLine(value: PromptStyle): string {
  if (value === "standard") {
    return "Use clear, natural, grammatically standard language. Avoid slang, heavy idioms, overly casual reductions, and expressions that may confuse learners.";
  }
  return "Use natural American English as people actually speak or message. Common casual phrasing is welcome, but do not force slang.";
}

function japaneseStyleLine(value: PromptStyle): string {
  if (value === "standard") {
    return "Use clear, natural, grammatically standard Japanese. Avoid heavy slang, overly casual reductions, and expressions that may confuse learners.";
  }
  return "Use natural everyday Japanese as people actually speak or message. Common casual phrasing is welcome, but do not force slang.";
}

function purposeLineFor(value: "rewrite" | "reply" | "dictionary"): string {
  if (value === "dictionary") {
    return "For dictionary output, the meaning and scenario should follow the difficulty; the example should follow both difficulty and style.";
  }
  if (value === "reply") {
    return "For friend replies, keep the response warm and conversational while following the difficulty and style.";
  }
  return "For rewrites, preserve the user's meaning and tone while following the difficulty and style.";
}
