import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLanguage } from "../../i18n";
import { getSession } from "../auth/authStorage";
import { environmentStorageKey } from "../storage/environmentStorageKey";
import type { CardInspirations } from "../api/cardApi";

type StoredInspirations = CardInspirations & { expiresAt: number };

export async function loadCardInspirations(appLocale = getLanguage()): Promise<CardInspirations | null> {
  const storageKey = await key(appLocale);
  if (!storageKey) return null;
  try {
    const value = JSON.parse((await AsyncStorage.getItem(storageKey)) ?? "null") as Partial<StoredInspirations> | null;
    if (!value || !Array.isArray(value.questions) || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()) return null;
    const questions = normalizeQuestions(value.questions);
    if (!questions.length) return null;
    return {
      questions,
      source: value.source === "personalized" ? "personalized" : "starter",
      expiresInSeconds: Math.max(1, Math.floor((value.expiresAt - Date.now()) / 1000)),
    };
  } catch {
    return null;
  }
}

export async function saveCardInspirations(value: CardInspirations, appLocale = getLanguage()): Promise<void> {
  const storageKey = await key(appLocale);
  if (!storageKey) return;
  const questions = normalizeQuestions(value.questions);
  if (!questions.length) return;
  const ttlSeconds = Math.max(300, Math.min(value.expiresInSeconds || 86_400, 86_400));
  const stored: StoredInspirations = { ...value, questions, expiresAt: Date.now() + ttlSeconds * 1000 };
  await AsyncStorage.setItem(storageKey, JSON.stringify(stored));
}

export function fallbackCardInspirations(): CardInspirations {
  const questions = getLanguage() === "zh-TW"
    ? ["最近有什麼小事讓你突然很開心？", "如果今天可以重來一次，你最想改變哪個瞬間？", "最近有什麼想法一直在你腦中打轉？"]
    : getLanguage() === "en-US"
      ? ["What small thing made you unexpectedly happy lately?", "If you could replay one moment today, what would you change?", "What idea has been circling in your mind lately?"]
      : getLanguage() === "ja-JP"
        ? ["最近、思いがけず嬉しかった小さな出来事は？", "今日を一度やり直せるなら、どの瞬間を変えたい？", "最近ずっと頭の中を巡っていることは？"]
        : ["最近有什么小事让你突然很开心？", "如果今天可以重来一次，你最想改变哪个瞬间？", "最近有什么想法一直在你脑子里打转？"];
  return { questions, source: "starter", expiresInSeconds: 86_400 };
}

async function key(appLocale: string): Promise<string | null> {
  const session = await getSession();
  return session?.user.id
    ? environmentStorageKey(`lf_card_inspirations_v1:${session.user.id}:${appLocale}`)
    : null;
}

function normalizeQuestions(value: unknown[]): string[] {
  return [...new Set(value.filter((question): question is string => typeof question === "string").map((question) => question.trim()).filter(Boolean))].slice(0, 3);
}
