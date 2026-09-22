export const CARD_REWRITE_ALIGNMENT_PROMPT_VERSION = "card_rewrite_alignment_v9";
export const CARD_REWRITE_ALIGNMENT_MAX_SHARED_TARGETS = 3;

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
      if (!isSourceUnitBoundary(input.sourceText, index)) continue;
      const end = trimEnd(input.sourceText, start, index + 1);
      if (start < end) units.push({ text: input.sourceText.slice(start, end), startUtf16: start, endUtf16: end });
      start = trimStart(input.sourceText, index + 1, segment.endUtf16);
    }
    const end = trimEnd(input.sourceText, start, segment.endUtf16);
    if (start < end) units.push({ text: input.sourceText.slice(start, end), startUtf16: start, endUtf16: end });
  }
  return units.map((unit, ordinal) => ({ ordinal, ...unit }));
}

function isSourceUnitBoundary(text: string, index: number): boolean {
  const character = text[index] ?? "";
  if (/[。！？!?；;：:，,、｡．؟؛،।॥။၊።\n]/u.test(character)) return true;
  if (character !== ".") return false;
  // The mixed-language source segmenter can leave several English sentences
  // in one segment. Split only a clear sentence-ending period, not decimals,
  // versions, initials, or common abbreviations.
  const before = text.slice(Math.max(0, index - 10), index);
  const after = text.slice(index + 1);
  return /[A-Za-z]$/u.test(before)
    && /^\s+["“‘'([{]*(?:[A-Z]|\p{Script=Han})/u.test(after)
    && !/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)|\b[A-Z])$/iu.test(before);
}

export function buildCardRewriteAlignmentPrompt(input: {
  sourceSegments: Array<{ ordinal: number; text: string }>;
  targetSegments: Array<{ ordinal: number; text: string }>;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `Align finalized rewrite sentences T to the user's exact original source fragments S by meaning. Source may mix languages and have messy punctuation. Do not change or resegment T.
Return groups in increasing T and S order; every T belongs to exactly one group. A group contains one T normally, at most three adjacent T only when they express the same original passage. Specify inclusive integer boundaries sourceStart/sourceEnd and targetStart/targetEnd, not arrays. A group must cover a continuous original S span; do not stretch a range across unrelated source ideas. Separate groups must not overlap source ranges. You may leave unused S filler. Do not invent IDs: source index must be 0..${input.sourceSegments.length - 1} and target index 0..${input.targetSegments.length - 1}.
Return JSON only, with no markdown or explanation, in exactly this shape:
{"groups":[{"targetStart":0,"targetEnd":0,"sourceStart":0,"sourceEnd":1},{"targetStart":1,"targetEnd":2,"sourceStart":2,"sourceEnd":3}]}`,
    userPrompt: JSON.stringify({
      source: input.sourceSegments.map((segment) => ({ id: `S${segment.ordinal}`, text: segment.text })),
      target: input.targetSegments.map((segment) => ({ id: `T${segment.ordinal}`, text: segment.text })),
    }),
  };
}

export function buildCardRewriteAlignmentRepairPrompt(input: {
  originalPrompt: { systemPrompt: string; userPrompt: string };
  invalidOutput: string;
  errorCode: string;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `${input.originalPrompt.systemPrompt}\nYour previous alignment was rejected with ${input.errorCode}. Correct the mapping from the original source and target units below. Return a complete JSON result, not a patch. Use inclusive start/end boundaries, never invented or non-contiguous source indexes. Do not fill a gap between distant source mentions. At most three adjacent target sentences may share a source passage. Never alter target sentences.`,
    userPrompt: JSON.stringify({
      sourceAndTarget: JSON.parse(input.originalPrompt.userPrompt),
      rejectedMatches: input.invalidOutput.slice(0, 12_000),
      rejection: input.errorCode,
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
    if (Math.min(...previous.sourceOrdinals) > Math.min(...current.sourceOrdinals)
      || Math.max(...previous.targetOrdinals) >= Math.min(...current.targetOrdinals)) {
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
  if (input.targetOrdinals.some((targetOrdinal) => !sourceForTarget.has(targetOrdinal))) {
    throw new Error("CARD_REWRITE_ALIGNMENT_MISSING_TARGET");
  }
  const completed = input.targetOrdinals.map((targetOrdinal) => ({
    sourceOrdinals: [...sourceForTarget.get(targetOrdinal)!],
    targetOrdinals: [targetOrdinal],
  }));
  // Models often use an inclusive S index as the end of one range and the
  // start of the next. Assign that single boundary unit to one side instead
  // of chaining otherwise separate target sentences into a giant group.
  for (let index = 1; index < completed.length; index += 1) {
    const previous = completed[index - 1]!;
    const current = completed[index]!;
    if (previous.sourceOrdinals.at(-1) !== current.sourceOrdinals[0]) continue;
    if (previous.sourceOrdinals.length === 1 && current.sourceOrdinals.length === 1) continue;
    if (previous.sourceOrdinals.length > 1) previous.sourceOrdinals.pop();
    else current.sourceOrdinals.shift();
  }
  return completed.reduce<CardRewriteAlignmentGroup[]>((result, group) => {
    const previous = result[result.length - 1];
    const overlaps = previous && group.sourceOrdinals[0]! <= previous.sourceOrdinals[previous.sourceOrdinals.length - 1]!;
    if (previous && overlaps) {
      if (previous.targetOrdinals.length >= CARD_REWRITE_ALIGNMENT_MAX_SHARED_TARGETS) {
        throw new Error("CARD_REWRITE_ALIGNMENT_SHARED_TARGET_LIMIT");
      }
      const first = Math.min(previous.sourceOrdinals[0]!, group.sourceOrdinals[0]!);
      const last = Math.max(previous.sourceOrdinals[previous.sourceOrdinals.length - 1]!, group.sourceOrdinals[group.sourceOrdinals.length - 1]!);
      previous.sourceOrdinals = Array.from({ length: last - first + 1 }, (_, index) => first + index);
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
    throw new Error(`CARD_REWRITE_ALIGNMENT_NON_CONTIGUOUS_${prefix === "S" ? "SOURCE" : "TARGET"}`);
  }
  return ordinals;
}

function ordinalRange(start: unknown, end: unknown): unknown {
  return start === undefined || end === undefined ? undefined : `${String(start)}-${String(end)}`;
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
