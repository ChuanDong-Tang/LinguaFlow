/** Prefer an explicit cursor over completion state, including when moving backwards. */
export function recallResumeIndex(nodes: ReadonlyArray<{ id: string; state: string }>, savedNodeId?: string | null): number {
  const saved = nodes.findIndex((node) => node.id === savedNodeId);
  if (saved >= 0) return saved;
  const current = nodes.findIndex((node) => node.state === "current");
  if (current >= 0) return current;
  const incomplete = nodes.findIndex((node) => node.state !== "completed");
  return incomplete >= 0 ? incomplete : Math.max(0, nodes.length - 1);
}

export function readRecallBookmark(raw: string | null, serverOpenedAt: string): string | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { nodeId?: unknown; savedAt?: unknown };
    if (typeof saved.nodeId !== "string" || typeof saved.savedAt !== "number" || !Number.isFinite(saved.savedAt)) return null;
    // A newer server cursor (for example from another device) takes precedence.
    return Date.parse(serverOpenedAt) > saved.savedAt ? null : saved.nodeId;
  } catch { return null; }
}
