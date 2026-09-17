export const CARD_REWRITE_ALIGNMENT_PROMPT_VERSION = "card_rewrite_alignment_v3";

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
The source may use any language or mix languages. An S unit is only a lookup fragment and may naturally end with a comma, semicolon, discourse pause, or other incomplete-sentence punctuation.
The rewrite is already final: never rewrite, translate, correct, split, merge, omit, or add text.
Return only an index mapping. Every T index and every S index must appear exactly once. Groups must preserve order and may map one-to-one, one-to-many, or many-to-one.
Use meaning rather than shared words or punctuation. Source fragments that only provide discourse context should be attached to the closest T unit whose meaning includes that context.

Before returning, flatten every source array and verify it exactly equals all supplied S indexes in order. Then flatten every target array and verify it exactly equals all supplied T indexes in order. Never omit filler, hesitation, or context-only S units; attach them to the closest relevant T group.

Return JSON only, with no markdown or explanation, in exactly this shape:
{"groups":[{"source":[0,1],"target":[0]},{"source":[2],"target":[1,2]}]}`,
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
  const rows = value && typeof value === "object" && Array.isArray((value as { groups?: unknown }).groups)
    ? (value as { groups: unknown[] }).groups
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

  validateCoverage(groups.flatMap((group) => group.sourceOrdinals), input.sourceOrdinals, "SOURCE");
  validateCoverage(groups.flatMap((group) => group.targetOrdinals), input.targetOrdinals, "TARGET");
  for (let index = 1; index < groups.length; index += 1) {
    const previous = groups[index - 1]!;
    const current = groups[index]!;
    if (Math.max(...previous.sourceOrdinals) >= Math.min(...current.sourceOrdinals)
      || Math.max(...previous.targetOrdinals) >= Math.min(...current.targetOrdinals)) {
      throw new Error("CARD_REWRITE_ALIGNMENT_NON_MONOTONIC");
    }
  }
  return groups;
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

function validateCoverage(actual: number[], expected: readonly number[], label: "SOURCE" | "TARGET"): void {
  if (actual.length !== expected.length || actual.some((ordinal, index) => ordinal !== expected[index])) {
    throw new Error(`CARD_REWRITE_ALIGNMENT_${label}_COVERAGE_MISMATCH`);
  }
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
