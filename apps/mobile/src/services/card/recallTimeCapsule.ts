export type RecallTimeCapsuleKind = "year" | "quarter" | "month" | "week";

export type RecallTimeCapsuleAnchor = {
  kind: RecallTimeCapsuleKind;
  dateKey: string;
};

export function recallTimeCapsuleAnchors(now: Date): RecallTimeCapsuleAnchor[] {
  return [
    { kind: "year", dateKey: localDateKey(shiftMonthsClamped(now, -12)) },
    { kind: "quarter", dateKey: localDateKey(shiftMonthsClamped(now, -3)) },
    { kind: "month", dateKey: localDateKey(shiftMonthsClamped(now, -1)) },
    { kind: "week", dateKey: localDateKey(shiftDays(now, -7)) },
  ];
}

export function mergeTimeCapsuleRecords<T extends { id: string }>(
  groups: ReadonlyArray<{ anchor: RecallTimeCapsuleAnchor; records: readonly T[] }>,
  limit = 50,
): { records: T[]; anchorByRecordId: Record<string, RecallTimeCapsuleAnchor> } {
  const records: T[] = [];
  const anchorByRecordId: Record<string, RecallTimeCapsuleAnchor> = {};
  const seen = new Set<string>();
  for (const group of groups) {
    for (const record of group.records) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
      anchorByRecordId[record.id] = group.anchor;
      if (records.length >= limit) return { records, anchorByRecordId };
    }
  }
  return { records, anchorByRecordId };
}

export function restoreTimeCapsuleRecordOrder<T extends { recordId: string }>(
  nodes: readonly T[],
  orderedRecordIds: readonly string[],
): T[] {
  const rank = new Map(orderedRecordIds.map((recordId, index) => [recordId, index]));
  return nodes
    .map((node, index) => ({ node, index, rank: rank.get(node.recordId) }))
    .sort((left, right) => {
      if (left.rank !== undefined && right.rank !== undefined) return left.rank - right.rank;
      if (left.rank !== undefined) return -1;
      if (right.rank !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ node }) => node);
}

export function timeCapsuleQuery(now: Date): string {
  return `time-capsule:${localDateKey(now)}`;
}

export function isTimeCapsuleQuery(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("time-capsule:");
}

function shiftMonthsClamped(now: Date, monthDelta: number): Date {
  const targetMonthStart = new Date(now.getFullYear(), now.getMonth() + monthDelta, 1, 12);
  const lastDay = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0, 12).getDate();
  targetMonthStart.setDate(Math.min(now.getDate(), lastDay));
  return targetMonthStart;
}

function shiftDays(now: Date, dayDelta: number): Date {
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  shifted.setDate(shifted.getDate() + dayDelta);
  return shifted;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
