import { dateToLocalKey } from "../../dateUtils.js";
import {
  deleteChatSessionRecord,
  listChatSessionRecords,
  overwriteChatSessionRecords,
  saveChatSessionRecord,
} from "../../../historyIdb.js";
import { type ChatTurn } from "./oioChatTypes";

export interface OioChatSession {
  id: string;
  dateKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
}

function normalizeTurn(raw: unknown): ChatTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : null;
  const sourceText = typeof value.sourceText === "string" ? value.sourceText : "";
  if (!id || !role) return null;
  if (role === "user" && !sourceText.trim()) return null;

  return {
    id,
    role,
    naturalVersion: typeof value.naturalVersion === "string" ? value.naturalVersion : undefined,
    reply: typeof value.reply === "string" ? value.reply : undefined,
    keyPhrases: Array.isArray(value.keyPhrases) ? value.keyPhrases.filter((item): item is string => typeof item === "string") : undefined,
    sourceText: sourceText || undefined,
    occurredAt: typeof value.occurredAt === "string" ? value.occurredAt : undefined,
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : undefined,
    capturedDateKey: typeof value.capturedDateKey === "string" ? value.capturedDateKey : undefined,
    countsTowardLimit: typeof value.countsTowardLimit === "boolean" ? value.countsTowardLimit : undefined,
    adminDebug: typeof value.adminDebug === "string" ? value.adminDebug : undefined,
    usageDailyUsed: typeof value.usageDailyUsed === "number" ? value.usageDailyUsed : undefined,
    usageDailyLimit: typeof value.usageDailyLimit === "number" ? value.usageDailyLimit : undefined,
    proficiencyPhrase: typeof value.proficiencyPhrase === "string" ? value.proficiencyPhrase : undefined,
    proficiencyDelta: typeof value.proficiencyDelta === "number" ? value.proficiencyDelta : undefined,
    proficiencyScore: typeof value.proficiencyScore === "number" ? value.proficiencyScore : undefined,
    phraseClientVersion: typeof value.phraseClientVersion === "number" ? value.phraseClientVersion : undefined,
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

  return {
    id,
    dateKey,
    title,
    createdAt,
    updatedAt,
    turns,
  };
}

export async function listChatSessions(): Promise<OioChatSession[]> {
  const records = await listChatSessionRecords();
  return records
    .map(normalizeSession)
    .filter((session): session is OioChatSession => !!session)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveChatSession(session: OioChatSession): Promise<void> {
  await saveChatSessionRecord(session);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await deleteChatSessionRecord(sessionId);
}

export async function overwriteChatSessions(nextSessions: OioChatSession[]): Promise<void> {
  await overwriteChatSessionRecords(nextSessions);
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
  };
}
