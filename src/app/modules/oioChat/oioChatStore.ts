import { dateToLocalKey } from "../../dateUtils.js";
import { type ChatTurn, type OioChatSessionKind } from "./oioChatTypes";

const STORAGE_KEY = "oio-chat-sessions-v1";

export interface OioChatSession {
  id: string;
  dateKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
  kind?: OioChatSessionKind;
  practice?: {
    itemId: string;
    question: string;
    targetPhrase?: string;
    referenceAnswer?: string;
    attempt: number;
  };
  practiceCompleted?: boolean;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function normalizeTurn(raw: unknown): ChatTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  const text = typeof value.text === "string" ? value.text : "";
  if (!id || !role) return null;
  if (role === "user" && !text.trim()) return null;

  return {
    id,
    role,
    text,
    mode: value.mode === "ask" ? "ask" : value.mode === "rewrite" ? "rewrite" : undefined,
    naturalVersion: typeof value.naturalVersion === "string" ? value.naturalVersion : undefined,
    reply: typeof value.reply === "string" ? value.reply : (typeof value.answer === "string" ? value.answer : undefined),
    answer: typeof value.answer === "string" ? value.answer : undefined,
    quickNote: typeof value.quickNote === "string" ? value.quickNote : undefined,
    keyPhrases: Array.isArray(value.keyPhrases) ? value.keyPhrases.filter((item): item is string => typeof item === "string") : undefined,
    sourceText: typeof value.sourceText === "string" ? value.sourceText : undefined,
    occurredAt: typeof value.occurredAt === "string" ? value.occurredAt : undefined,
    encouragement: typeof value.encouragement === "string" ? value.encouragement : undefined,
    isAlreadyNatural: typeof value.isAlreadyNatural === "boolean" ? value.isAlreadyNatural : undefined,
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : undefined,
    capturedDateKey: typeof value.capturedDateKey === "string" ? value.capturedDateKey : undefined,
    countsTowardLimit: typeof value.countsTowardLimit === "boolean" ? value.countsTowardLimit : undefined,
    practiceKind: value.practiceKind === "question" ? "question" : value.practiceKind === "feedback" ? "feedback" : undefined,
    adminDebug: typeof value.adminDebug === "string" ? value.adminDebug : undefined,
    usageDailyUsed: typeof value.usageDailyUsed === "number" ? value.usageDailyUsed : undefined,
    usageDailyLimit: typeof value.usageDailyLimit === "number" ? value.usageDailyLimit : undefined,
  };
}

function normalizeSession(raw: unknown): OioChatSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) return null;

  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  const dateKey = typeof value.dateKey === "string" && value.dateKey ? value.dateKey : dateToLocalKey(new Date(createdAt));
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "New conversation";
  const turns = Array.isArray(value.turns)
    ? value.turns
      .map(normalizeTurn)
      .filter((turn): turn is ChatTurn => !!turn)
      .map((turn) => ({
        ...turn,
        occurredAt: turn.occurredAt ?? createdAt,
      }))
    : [];
  const kind = value.kind === "practice" ? "practice" : value.kind === "chat" ? "chat" : undefined;
  const practiceRaw = value.practice && typeof value.practice === "object" ? (value.practice as Record<string, unknown>) : null;
  const practice = practiceRaw && typeof practiceRaw.itemId === "string" && typeof practiceRaw.question === "string"
    ? {
      itemId: practiceRaw.itemId,
      question: practiceRaw.question,
      targetPhrase: typeof practiceRaw.targetPhrase === "string" ? practiceRaw.targetPhrase : undefined,
      referenceAnswer: typeof practiceRaw.referenceAnswer === "string" ? practiceRaw.referenceAnswer : undefined,
      attempt: typeof practiceRaw.attempt === "number" ? practiceRaw.attempt : 0,
    }
    : undefined;
  const practiceCompleted = typeof value.practiceCompleted === "boolean" ? value.practiceCompleted : undefined;

  return {
    id,
    dateKey,
    title,
    createdAt,
    updatedAt,
    turns,
    kind,
    practice,
    practiceCompleted,
  };
}

function readSessions(): OioChatSession[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession).filter((session): session is OioChatSession => !!session);
  } catch {
    return [];
  }
}

function writeSessions(sessions: OioChatSession[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export async function listChatSessions(): Promise<OioChatSession[]> {
  return readSessions().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveChatSession(session: OioChatSession): Promise<void> {
  const sessions = readSessions();
  const nextSessions = sessions.filter((item) => item.id !== session.id);
  nextSessions.push(session);
  writeSessions(nextSessions);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const sessions = readSessions().filter((item) => item.id !== sessionId);
  writeSessions(sessions);
}

export async function overwriteChatSessions(nextSessions: OioChatSession[]): Promise<void> {
  writeSessions(nextSessions);
}

export function createChatSession(date = new Date()): OioChatSession {
  const timestamp = date.toISOString();
  return {
    id: `chat-${Date.now()}`,
    dateKey: dateToLocalKey(date),
    title: "New conversation",
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [],
    kind: "chat",
  };
}
