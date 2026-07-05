import type { ChatContact } from "../chat/contacts";
import type { ChatMessage, ClozeState } from "../chat/types";
import { getAssistantClozeText } from "./clozeText";
import { tokenizeForCloze, type ClozeToken } from "./clozeUtils";

type AutoClozeGroup = {
  tokenIndexes: number[];
  blankTokenIndexes: number[];
  score: number;
};

const EN_STOP_WORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "at", "for", "with", "from", "by", "as",
  "is", "are", "am", "was", "were", "be", "been", "being", "do", "does", "did",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
  "and", "or", "but", "so", "if", "then", "just", "really", "very",
]);

const EN_PARTICLES = new Set(["out", "up", "off", "in", "on", "over", "away", "back", "through"]);
const EN_SHORT_PREPOSITIONS = new Set(["to", "for", "of", "with", "about", "into", "from"]);
const JA_PARTICLES = new Set(["は", "が", "を", "に", "で", "と", "も", "の", "へ", "から", "まで", "より", "ね", "よ"]);

export function createAutoClozeState(
  message: Pick<ChatMessage, "text" | "languageCode" | "clozeState">,
  contact: Pick<ChatContact, "clozeSource">,
): ClozeState | null {
  if (message.clozeState) return null;
  const text = getAssistantClozeText(message as ChatMessage, contact).text.trim();
  if (!text) return null;
  const tokens = tokenizeForCloze(text);
  const wordCount = tokens.filter((token) => token.kind === "word").length;
  if (wordCount < 5) return null;

  const language = inferClozeLanguage(text, message.languageCode);
  const groups = language === "ja-JP"
    ? pickJapaneseGroups(tokens, wordCount)
    : pickEnglishGroups(tokens, wordCount);
  if (!groups.length) return null;

  return {
    groups: groups.map(({ tokenIndexes, blankTokenIndexes }) => ({ tokenIndexes, blankTokenIndexes })),
    correctTokenIndexes: [],
  };
}

function inferClozeLanguage(text: string, languageCode?: string | null): "en-US" | "ja-JP" {
  if (languageCode === "ja-JP") return "ja-JP";
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? "ja-JP" : "en-US";
}

function pickEnglishGroups(tokens: ClozeToken[], wordCount: number): AutoClozeGroup[] {
  const candidates: AutoClozeGroup[] = [];
  const words = tokens.filter((token) => token.kind === "word");
  for (let i = 0; i < words.length; i += 1) {
    const current = words[i];
    const next = words[i + 1];
    const afterNext = words[i + 2];
    if (!current || !isEnglishContentWord(current)) continue;
    if (next && isExactNextToken(tokens, current, next) && isEnglishPhraseTail(next)) {
      candidates.push({
        tokenIndexes: [current.index, next.index],
        blankTokenIndexes: [current.index],
        score: scoreEnglishToken(current) + 4,
      });
    }
    if (
      next &&
      afterNext &&
      isExactNextToken(tokens, current, next) &&
      isExactNextToken(tokens, next, afterNext) &&
      isEnglishContentWord(next) &&
      EN_SHORT_PREPOSITIONS.has(afterNext.text.toLowerCase())
    ) {
      candidates.push({
        tokenIndexes: [current.index, next.index, afterNext.index],
        blankTokenIndexes: [next.index],
        score: scoreEnglishToken(next) + 5,
      });
    }
    candidates.push({
      tokenIndexes: [current.index],
      blankTokenIndexes: [current.index],
      score: scoreEnglishToken(current),
    });
  }
  return takeNonOverlapping(candidates, wordCount >= 14 ? 2 : 1);
}

function pickJapaneseGroups(tokens: ClozeToken[], wordCount: number): AutoClozeGroup[] {
  const candidates = tokens
    .filter((token) => token.kind === "word" && isJapaneseContentToken(token))
    .map((token) => ({
      tokenIndexes: [token.index],
      blankTokenIndexes: [token.index],
      score: scoreJapaneseToken(token),
    }));
  return takeNonOverlapping(candidates, wordCount >= 12 ? 2 : 1);
}

function takeNonOverlapping(candidates: AutoClozeGroup[], limit: number): AutoClozeGroup[] {
  const used = new Set<number>();
  const picked: AutoClozeGroup[] = [];
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.tokenIndexes[0] - b.tokenIndexes[0]);
  for (const candidate of sorted) {
    if (candidate.tokenIndexes.some((index) => used.has(index))) continue;
    candidate.tokenIndexes.forEach((index) => used.add(index));
    picked.push(candidate);
    if (picked.length >= limit) break;
  }
  return picked.sort((a, b) => a.tokenIndexes[0] - b.tokenIndexes[0]);
}

function isExactNextToken(tokens: ClozeToken[], a: ClozeToken, b: ClozeToken): boolean {
  return tokens.find((token) => token.index === a.index + 1)?.index === b.index;
}

function isEnglishContentWord(token: ClozeToken): boolean {
  const value = token.text.toLowerCase();
  if (value.length < 4) return false;
  if (!/[a-z]/i.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return !EN_STOP_WORDS.has(value);
}

function isEnglishPhraseTail(token: ClozeToken): boolean {
  const value = token.text.toLowerCase();
  return EN_PARTICLES.has(value) || EN_SHORT_PREPOSITIONS.has(value);
}

function scoreEnglishToken(token: ClozeToken): number {
  const value = token.text.toLowerCase();
  let score = Math.min(value.length, 10);
  if (/(ed|ing|able|ful|ive|tion|ment|ness|ally)$/.test(value)) score += 2;
  if (value.includes("'") || value.includes("’")) score -= 2;
  return score;
}

function isJapaneseContentToken(token: ClozeToken): boolean {
  const value = token.text;
  if (value.length < 2) return false;
  if (JA_PARTICLES.has(value)) return false;
  return /[\p{Script=Han}\p{Script=Katakana}]/u.test(value);
}

function scoreJapaneseToken(token: ClozeToken): number {
  let score = Math.min(token.text.length, 6);
  if (/[\p{Script=Han}]/u.test(token.text)) score += 3;
  if (/[\p{Script=Katakana}]/u.test(token.text)) score += 2;
  return score;
}
