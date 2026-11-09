// Podcast "主题": group a user's memories into a handful of recurring themes
// (e.g. 新房装修, 日本旅行) so each can be played as a playlist.

export const CARD_THEME_PROMPT_VERSION = "card_theme_v1" as const;
export const CARD_THEME_MAX_THEMES = 10;
export const CARD_THEME_LABEL_MAX_CHARS = 12;

export function buildCardThemePrompt(input: { titles: string[]; appLocale?: string | null }): { systemPrompt: string; userPrompt: string; version: typeof CARD_THEME_PROMPT_VERSION } {
  const language = localeName(input.appLocale);
  return {
    version: CARD_THEME_PROMPT_VERSION,
    systemPrompt: `You organize a person's life journal into recurring themes for playlists.

You get numbered memory titles. Find 3 to ${CARD_THEME_MAX_THEMES} themes that each cover several memories (a project, a place, a relationship, a hobby, a recurring situation). Prefer concrete, personal themes over generic categories like "生活" or "日常".

Rules:
- Each theme label is a short phrase in ${language}, at most ${CARD_THEME_LABEL_MAX_CHARS} characters, no punctuation or emoji.
- Each theme lists the numbers of its memories; a theme needs at least 2 memories. A memory may belong to more than one theme; memories that fit no theme are left out.
- Order themes from the largest to the smallest.
- Use only the facts in the titles.
- Return only JSON: {"themes":[{"label":"…","items":[1,2]}]} with no markdown or explanation.`,
    userPrompt: input.titles.map((title, index) => `${index + 1}. ${title.replace(/\s+/gu, " ").trim()}`).join("\n"),
  };
}

/** Parse model output into themes with 0-based item indexes; invalid parts are dropped. */
export function parseCardThemeOutput(value: string, itemCount: number): Array<{ label: string; items: number[] }> {
  const json = value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw themeError("CARD_THEME_INVALID_JSON"); }
  const themes = (parsed as { themes?: unknown })?.themes;
  if (!Array.isArray(themes)) throw themeError("CARD_THEME_INVALID_JSON");
  const seen = new Set<string>();
  const result: Array<{ label: string; items: number[] }> = [];
  for (const theme of themes) {
    const label = typeof theme?.label === "string" ? Array.from(theme.label.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/[\s\p{P}]+/gu, " ").trim()).slice(0, CARD_THEME_LABEL_MAX_CHARS).join("").trim() : "";
    const items = Array.isArray(theme?.items)
      ? [...new Set((theme.items as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= itemCount).map((n) => n - 1))]
      : [];
    if (!label || items.length < 2 || seen.has(label)) continue;
    seen.add(label);
    result.push({ label, items });
    if (result.length >= CARD_THEME_MAX_THEMES) break;
  }
  return result;
}

function localeName(value?: string | null): string {
  if (value === "zh-TW") return "Traditional Chinese";
  if (value === "en-US") return "English";
  if (value === "ja-JP") return "Japanese";
  return "Simplified Chinese";
}

function themeError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}
