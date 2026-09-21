export type ClozeVisualRange = {
  start: number;
  end: number;
  groupIndex?: number;
};

export function splitClozeRangesIntoWordRuns<T extends ClozeVisualRange>(text: string, ranges: T[]): T[] {
  return ranges.flatMap((range) => {
    const runs: T[] = [];
    const selectedText = text.slice(range.start, range.end);
    for (const match of selectedText.matchAll(/\S+/gu)) {
      const start = range.start + (match.index ?? 0);
      runs.push({ ...range, start, end: start + match[0].length });
    }
    return runs.length ? runs : [range];
  });
}

export function nativeClozeAnswerRangesForPlatform<T>(platform: string, ranges: T[]): T[] {
  // Android's replacement span removes the masked text from the native layout,
  // so it needs a separate answer layer after a blank is answered. On iOS the
  // original text becomes visible again when the mask is removed; drawing the
  // answer layer there would render the same word twice in the same position.
  return platform === "android" ? ranges : [];
}
