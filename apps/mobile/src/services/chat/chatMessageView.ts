import type { ChatMessage } from "../../domain/chat/types";

export function toDisplayRows(rows: ChatMessage[]): ChatMessage[] {
  return rows.filter((row) => row.status === "success" || row.status === "pending");
}

export function isSameChatMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (a.id !== undefined && b.id !== undefined && a.id === b.id) || a.localId === b.localId;
}

export function areMessageRowsEquivalent(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.localId !== right.localId ||
      left.role !== right.role ||
      left.text !== right.text ||
      left.status !== right.status ||
      left.createdAt !== right.createdAt ||
      (left.clozeVersion ?? 0) !== (right.clozeVersion ?? 0) ||
      JSON.stringify(left.clozeState ?? null) !== JSON.stringify(right.clozeState ?? null)
    ) {
      return false;
    }
  }
  return true;
}
