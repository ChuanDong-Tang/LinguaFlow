import type { ChatMessage } from "./types";

export function clampMessages(rows: ChatMessage[], max = 120): ChatMessage[] {
  if (rows.length <= max) return rows;
  return rows.slice(rows.length - max);
}

export function getVisibleWindow<T>(rows: T[], max = 120): {
  start: number;
  end: number;
  items: T[];
} {
  const end = rows.length;
  const start = Math.max(0, end - max);
  return {
    start,
    end,
    items: rows.slice(start, end),
  };
}

// deprecated
export function updateMessageByLocalId(
  rows: ChatMessage[],
  localId: string,
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  return rows.map((row) => (row.localId === localId ? updater(row) : row));
}

export function updateMessageByClientId(
  rows: ChatMessage[],
  clientId: string,
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  return rows.map((row) => (row.clientId === clientId ? updater(row) : row));
}

export function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function filterByDate(rows: ChatMessage[], date: Date): ChatMessage[] {
  const dateKey = toDateKey(date);
  return rows.filter((row) => {
    return getMessageDateKey(row) === dateKey;
  });
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getMessageDateKey(row: ChatMessage): string {
  return row.conversationDateKey || toDateKey(new Date(row.createdAt));
}

export function compareChatMessagesByCreatedAt(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.role !== b.role) return a.role === "user" ? -1 : 1;
  return (a.clientId || a.localId).localeCompare(b.clientId || b.localId);
}

export function mergeByLocalId(allRows: ChatMessage[], incomingRows: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  const getKey = (row: ChatMessage): string => row.serverId ?? row.clientId ?? row.id ?? row.localId;
  for (const row of allRows) map.set(getKey(row), row);
  for (const row of incomingRows) map.set(getKey(row), row);
  return Array.from(map.values()).sort(compareChatMessagesByCreatedAt);
}

export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
