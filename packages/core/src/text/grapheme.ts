type SegmenterLike = {
  segment(input: string): Iterable<unknown>;
};

function createSegmenter(): SegmenterLike | null {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string | string[], options?: { granularity: "grapheme" }) => SegmenterLike;
  }).Segmenter;
  return Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;
}

const graphemeSegmenter = createSegmenter();

export function countGraphemes(value: string): number {
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(value)).length;
  return Array.from(value).length;
}

export function truncateGraphemes(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (!graphemeSegmenter) return Array.from(value).slice(0, maxLength).join("");
  const segments = Array.from(graphemeSegmenter.segment(value)) as Array<{ segment?: string }>;
  return segments.slice(0, maxLength).map((item) => item.segment ?? "").join("");
}

export function isUtf16GraphemeBoundary(value: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > value.length) return false;
  if (offset === 0 || offset === value.length) return true;
  if (!graphemeSegmenter) {
    const code = value.charCodeAt(offset);
    return !(code >= 0xdc00 && code <= 0xdfff);
  }
  let cursor = 0;
  for (const item of graphemeSegmenter.segment(value) as Iterable<{ segment?: string }>) {
    cursor += (item.segment ?? "").length;
    if (cursor === offset) return true;
    if (cursor > offset) return false;
  }
  return false;
}
