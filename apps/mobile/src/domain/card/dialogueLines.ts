/**
 * 对话卡 (OIO AI, 2026-11): the card's text holds the user's lines and its
 * reply holds OIO's, one line per chat message, paired by line number. A line
 * may hold several sentence segments.
 */
type Segment = { id: string; startUtf16: number };

/** Which line (0-based) each segment starts on. */
export function segmentLines(text: string, segments: readonly Segment[]): Map<string, number> {
  const breaks: number[] = [];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) breaks.push(index);
  return new Map(segments.map((segment) => [segment.id, breaks.filter((at) => at < segment.startUtf16).length]));
}

export type DialoguePair = { line: number; user: string[]; oio: string[] };

/** Pairs in reading order: the user's line, then OIO's reply to it. */
export function dialoguePairs(user: { text: string; segments: readonly Segment[] }, oio: { text: string; segments: readonly Segment[] } | null): DialoguePair[] {
  const userLines = segmentLines(user.text, user.segments);
  const oioLines = oio ? segmentLines(oio.text, oio.segments) : new Map<string, number>();
  const count = Math.max(0, ...[...userLines.values(), ...oioLines.values()].map((line) => line + 1));
  return Array.from({ length: count }, (_, line) => ({
    line,
    user: user.segments.filter((segment) => userLines.get(segment.id) === line).map((segment) => segment.id),
    oio: (oio?.segments ?? []).filter((segment) => oioLines.get(segment.id) === line).map((segment) => segment.id),
  })).filter((pair) => pair.user.length || pair.oio.length);
}
