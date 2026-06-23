import type { ChatMessage, ClozeState } from "../chat/types";
import { DEFAULT_CHAT_CONTACT, type ChatContact } from "../chat/contacts";
import { getMessageDateKey } from "../chat/messageState";
import { normalizeClozeState, tokenizeForCloze, type ClozeToken } from "../cloze/clozeUtils";
import { getAssistantClozeText } from "../cloze/clozeText";
import { normalizeLearningText } from "../learning/learningText";

export type PracticeAccuracyBand = "low" | "mid" | "high" | "any";

export type PracticeCard = {
  id: string;
  messageId: string;
  contactId: string;
  message: ChatMessage;
  dateKey: string;
  text: string;
  translation: string;
  sourceText: string;
  languageCode: string;
  textStart: number;
  textEnd: number;
  tokens: ClozeToken[];
  groupIndex: number;
  phraseTokenIndexes: number[];
  blankTokenIndexes: number[];
  correctTokenIndexes: number[];
};

export type PracticeDayStats = {
  dateKey: string;
  total: number;
  correct: number;
  accuracy: number;
  band: Exclude<PracticeAccuracyBand, "any">;
};

// 从聊天消息生成练习卡。练习基于统一规范化后的 sourceText；标签里的 note/reply 只作为卡片下方的弱化对照。
export function buildPracticeCards(
  messages: ChatMessage[],
  options?: { includeCompleted?: boolean; contact?: ChatContact; contactByMessageId?: Map<string, ChatContact> },
): PracticeCard[] {
  const cards: PracticeCard[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role !== "assistant" || message.status !== "success") continue;
    const messageKey = message.id ?? message.localId;
    const contact = options?.contactByMessageId?.get(messageKey) ?? options?.contact ?? DEFAULT_CHAT_CONTACT;
    if (message.clozePracticeDiscardedAt) continue;
    const state = normalizeClozeState(message.clozeState);
    if (!state) continue;
    const clozeText = getAssistantClozeText(message, contact);
    const sourceLanguageCode = message.languageCode ?? "en-US";
    const sourceText = normalizeLearningText({
      text: clozeText.text,
      languageCode: sourceLanguageCode,
    });
    if (!sourceText) continue;
    const tokens = tokenizeForCloze(sourceText);
    const translation = clozeText.translation || findPreviousUserText(messages, i);
    const dateKey = getMessageDateKey(message);
    const phraseTokenIndexes = new Set<number>();
    const blankTokenIndexes = new Set<number>();
    const sourceBlankIndexes = new Set<number>();

    state.groups.forEach((group) => {
      if (!group.blankTokenIndexes.length) return;
      group.tokenIndexes.forEach((index) => phraseTokenIndexes.add(index));
      group.blankTokenIndexes.forEach((index) => sourceBlankIndexes.add(index));
      group.blankTokenIndexes.forEach((index) => blankTokenIndexes.add(index));
    });

    if (!blankTokenIndexes.size) continue;
    const correctTokenIndexes = state.correctTokenIndexes.filter((index) => sourceBlankIndexes.has(index));
    cards.push({
      id: `${contact.id}:${messageKey}:all`,
      messageId: messageKey,
      contactId: contact.id,
      message,
      dateKey,
      text: sourceText,
      translation,
      sourceText,
      languageCode: sourceLanguageCode,
      textStart: 0,
      textEnd: sourceText.length,
      tokens,
      groupIndex: 0,
      phraseTokenIndexes: Array.from(phraseTokenIndexes).sort((a, b) => a - b),
      blankTokenIndexes: Array.from(blankTokenIndexes).sort((a, b) => a - b),
      correctTokenIndexes,
    });
  }
  return cards;
}

// 日历正确率需要包含已完成卡，否则某天全做完后会从日历上消失。
export function summarizePracticeDays(
  messages: ChatMessage[],
  options?: { contact?: ChatContact; contactByMessageId?: Map<string, ChatContact> },
): Map<string, PracticeDayStats> {
  const map = new Map<string, PracticeDayStats>();
  for (const card of buildPracticeCards(messages, { ...options, includeCompleted: true })) {
    const current = map.get(card.dateKey) ?? {
      dateKey: card.dateKey,
      total: 0,
      correct: 0,
      accuracy: 0,
      band: "low" as const,
    };
    current.total += card.blankTokenIndexes.length;
    current.correct += card.correctTokenIndexes.length;
    current.accuracy = current.total > 0 ? current.correct / current.total : 0;
    current.band = accuracyToBand(current.accuracy);
    map.set(card.dateKey, current);
  }
  return map;
}

export function accuracyToBand(accuracy: number): Exclude<PracticeAccuracyBand, "any"> {
  if (accuracy >= 0.6) return "high";
  if (accuracy >= 0.2) return "mid";
  return "low";
}

export function getCardAccuracyBand(card: PracticeCard): Exclude<PracticeAccuracyBand, "any"> {
  const total = card.blankTokenIndexes.length;
  const correct = card.correctTokenIndexes.length;
  return accuracyToBand(total > 0 ? correct / total : 0);
}

export function filterPracticeCards(input: {
  cards: PracticeCard[];
  recentDays: number;
  limit: number;
  band: PracticeAccuracyBand;
  today?: Date;
}): PracticeCard[] {
  const today = input.today ?? new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - input.recentDays + 1);
  const eligible = input.cards.filter((card) => {
    const d = new Date(`${card.dateKey}T00:00:00`);
    if (d < start) return false;
    if (input.band !== "any" && getCardAccuracyBand(card) !== input.band) return false;
    return true;
  });
  return shuffle(eligible).slice(0, input.limit);
}

// 检查答案成功后，只把本次答对的 token 合并进 correctTokenIndexes。
export function applyCorrectAnswers(
  state: ClozeState | null | undefined,
  correctIndexes: number[],
): ClozeState | null {
  const normalized = normalizeClozeState(state);
  if (!normalized) return null;
  const next = new Set(normalized.correctTokenIndexes);
  correctIndexes.forEach((index) => next.add(index));
  return normalizeClozeState({
    groups: normalized.groups,
    correctTokenIndexes: Array.from(next).sort((a, b) => a - b),
  });
}

export function getBlankAnswers(card: PracticeCard): Map<number, string> {
  const tokens = tokenizeForCloze(card.text);
  const map = new Map<number, string>();
  card.blankTokenIndexes.forEach((index) => {
    const token = tokens[index];
    if (token) map.set(index, token.text);
  });
  return map;
}

function findPreviousUserText(messages: ChatMessage[], assistantIndex: number): string {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].text;
  }
  return "";
}

function shuffle<T>(rows: T[]): T[] {
  const next = rows.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}
