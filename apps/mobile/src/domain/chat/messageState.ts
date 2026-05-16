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

export function updateMessageByLocalId(
  rows: ChatMessage[],
  localId: string,
  updater: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  return rows.map((row) => (row.localId === localId ? updater(row) : row));
}

export function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function filterByDate(rows: ChatMessage[], date: Date): ChatMessage[] {
  return rows.filter((row) => {
    const d = new Date(row.createdAt);
    return isSameDate(d, date);
  });
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function mergeByLocalId(allRows: ChatMessage[], incomingRows: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const row of allRows) map.set(row.localId, row);
  for (const row of incomingRows) map.set(row.localId, row);
  return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
