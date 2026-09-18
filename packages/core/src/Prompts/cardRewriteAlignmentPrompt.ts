export const CARD_REWRITE_ALIGNMENT_PROMPT_VERSION = "card_rewrite_alignment_v5";

export interface CardRewriteAlignmentGroup {
  sourceOrdinals: number[];
  targetOrdinals: number[];
}

export interface CardRewriteAlignmentResult {
  schemaVersion: 1;
  promptVersion: typeof CARD_REWRITE_ALIGNMENT_PROMPT_VERSION;
  sourceContentVersion: string;
  targetContentVersion: string;
  sourceUnits: Array<{ ordinal: number; startUtf16: number; endUtf16: number }>;
  groups: CardRewriteAlignmentGroup[];
}

export function buildCardRewriteAlignmentSourceUnits(input: {
  sourceText: string;
  segments: Array<{ startUtf16: number; endUtf16: number }>;
}): Array<{ ordinal: number; text: string; startUtf16: number; endUtf16: number }> {
  const units: Array<{ text: string; startUtf16: number; endUtf16: number }> = [];
  for (const segment of input.segments) {
    let start = trimStart(input.sourceText, segment.startUtf16, segment.endUtf16);
    for (let index = start; index < segment.endUtf16; index += 1) {
      if (!/[。！？!?；;：:，,、｡．؟؛،।॥။၊።\n]/u.test(input.sourceText[index] ?? "")) continue;
      const end = trimEnd(input.sourceText, start, index + 1);
      if (start < end) units.push({ text: input.sourceText.slice(start, end), startUtf16: start, endUtf16: end });
      start = trimStart(input.sourceText, index + 1, segment.endUtf16);
    }
    const end = trimEnd(input.sourceText, start, segment.endUtf16);
    if (start < end) units.push({ text: input.sourceText.slice(start, end), startUtf16: start, endUtf16: end });
  }
  return units.map((unit, ordinal) => ({ ordinal, ...unit }));
}

export function buildCardRewriteAlignmentPrompt(input: {
  sourceSegments: Array<{ ordinal: number; text: string }>;
  targetSegments: Array<{ ordinal: number; text: string }>;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `Align a finalized rewrite back to the user's source record by complete meaning units.
Treat each T unit in the rewrite as the display anchor. For each T unit, find the consecutive S unit or units in the source that express the meaning rewritten there. Do not force the rewrite to follow the source's sentence boundaries or sentence count.
The rewrite may reorder ideas for natural expression. Keep matches in T order, but do not force the S indexes of later T matches to be greater than earlier ones.
The source may use any language or mix languages. An S unit is only a lookup fragment and may naturally end with a comma, semicolon, discourse pause, or other incomplete-sentence punctuation.
The rewrite is already final: never rewrite, translate, correct, split, merge, omit, or add text.
Return one match for every T index, in T order. Each match must contain the consecutive S index or indexes that express that T unit's meaning. The same S indexes may be used by adjacent T matches when one source passage becomes multiple rewrite sentences. Source filler or hesitation that is not expressed in the rewrite may remain unused.
Use meaning rather than shared words or punctuation. Never leave a T index unmatched.

Return JSON only, with no markdown or explanation, in exactly this shape:
{"matches":[{"target":0,"source":[0,1]},{"target":1,"source":[2]}]}`,
    userPrompt: JSON.stringify({
      source: input.sourceSegments.map((segment) => ({ id: `S${segment.ordinal}`, text: segment.text })),
      target: input.targetSegments.map((segment) => ({ id: `T${segment.ordinal}`, text: segment.text })),
    }),
  };
}

export function parseCardRewriteAlignmentOutput(input: {
  output: string;
  sourceOrdinals: readonly number[];
  targetOrdinals: readonly number[];
}): CardRewriteAlignmentGroup[] {
  const value = parseJsonObject(input.output);
  const candidateRows = value && typeof value === "object"
    ? (value as { matches?: unknown; groups?: unknown }).matches ?? (value as { groups?: unknown }).groups
    : null;
  const rows = Array.isArray(candidateRows)
    ? candidateRows
    : null;
  if (!rows?.length) throw new Error("CARD_REWRITE_ALIGNMENT_INVALID_FORMAT");

  const groups = rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("CARD_REWRITE_ALIGNMENT_INVALID_GROUP");
    const typedRow = row as Record<string, unknown>;
    const sourceOrdinals = parseOrdinals(
      typedRow.source ?? typedRow.sourceOrdinals ?? typedRow.source_ids
        ?? ordinalRange(typedRow.sourceStart, typedRow.sourceEnd),
      "S",
    );
    const targetOrdinals = parseOrdinals(
      typedRow.target ?? typedRow.targetOrdinals ?? typedRow.target_ids
        ?? ordinalRange(typedRow.targetStart, typedRow.targetEnd),
      "T",
    );
    return { sourceOrdinals, targetOrdinals };
  });

  const sourceSet = new Set(input.sourceOrdinals);
  const targetSet = new Set(input.targetOrdinals);
  if (groups.some((group) => group.sourceOrdinals.some((ordinal) => !sourceSet.has(ordinal))
    || group.targetOrdinals.some((ordinal) => !targetSet.has(ordinal)))) {
    throw new Error("CARD_REWRITE_ALIGNMENT_ORDINAL_OUT_OF_RANGE");
  }
  for (let index = 1; index < groups.length; index += 1) {
    const previous = groups[index - 1]!;
    const current = groups[index]!;
    if (Math.max(...previous.targetOrdinals) >= Math.min(...current.targetOrdinals)) {
      throw new Error("CARD_REWRITE_ALIGNMENT_NON_MONOTONIC");
    }
  }
  const sourceForTarget = new Map<number, number[]>();
  for (const group of groups) {
    for (const targetOrdinal of group.targetOrdinals) {
      if (sourceForTarget.has(targetOrdinal)) throw new Error("CARD_REWRITE_ALIGNMENT_DUPLICATE_TARGET");
      sourceForTarget.set(targetOrdinal, group.sourceOrdinals);
    }
  }
  const fallbackSource = [...input.sourceOrdinals];
  const completed = input.targetOrdinals.map((targetOrdinal) => ({
    sourceOrdinals: sourceForTarget.get(targetOrdinal) ?? fallbackSource,
    targetOrdinals: [targetOrdinal],
  }));
  return completed.reduce<CardRewriteAlignmentGroup[]>((result, group) => {
    const previous = result[result.length - 1];
    if (previous && sameOrdinals(previous.sourceOrdinals, group.sourceOrdinals)) {
      previous.targetOrdinals.push(...group.targetOrdinals);
    } else {
      result.push({ sourceOrdinals: [...group.sourceOrdinals], targetOrdinals: [...group.targetOrdinals] });
    }
    return result;
  }, []);
}

function parseJsonObject(output: string): unknown {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseOrdinals(value: unknown, prefix: "S" | "T"): number[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  if (!values.length) throw new Error("CARD_REWRITE_ALIGNMENT_INVALID_GROUP");
  const ordinals = values.flatMap((item) => {
    if (Number.isInteger(item) && (item as number) >= 0) return item as number;
    if (typeof item === "string") {
      if (item.includes(",")) return item.split(",").flatMap((part) => parseOrdinals(part.trim(), prefix));
      const match = new RegExp(`^${prefix}?(\\d+)$`, "u").exec(item.trim());
      if (match) return Number(match[1]);
      const range = new RegExp(`^${prefix}?(\\d+)\\s*[-–—]\\s*${prefix}?(\\d+)$`, "u").exec(item.trim());
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (end >= start) return Array.from({ length: end - start + 1 }, (_, index) => start + index);
      }
    }
    throw new Error("CARD_REWRITE_ALIGNMENT_INVALID_GROUP");
  });
  if (ordinals.some((ordinal, index) => index > 0 && ordinal <= ordinals[index - 1]!)) {
    throw new Error("CARD_REWRITE_ALIGNMENT_NON_MONOTONIC");
  }
  if (ordinals.length > 1 && ordinals.some((ordinal, index) => index > 0 && ordinal !== ordinals[index - 1]! + 1)) {
    return Array.from({ length: ordinals[ordinals.length - 1]! - ordinals[0]! + 1 }, (_, index) => ordinals[0]! + index);
  }
  return ordinals;
}

function ordinalRange(start: unknown, end: unknown): unknown {
  return start === undefined || end === undefined ? undefined : `${String(start)}-${String(end)}`;
}

function sameOrdinals(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((ordinal, index) => ordinal === right[index]);
}

function trimStart(text: string, start: number, end: number): number {
  let index = start;
  while (index < end && /\s/u.test(text[index] ?? "")) index += 1;
  return index;
}

function trimEnd(text: string, start: number, end: number): number {
  let index = end;
  while (index > start && /\s/u.test(text[index - 1] ?? "")) index -= 1;
  return index;
}
