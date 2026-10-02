export type DictionaryPopoverLayoutAnchor = {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
};

export const DICTIONARY_POPOVER_WIDTH = 312;
const POPOVER_MARGIN = 12;
const POPOVER_BODY_HEIGHT = 260;
const POPOVER_ESTIMATED_HEIGHT = 340;
const BOTTOM_CHROME_HEIGHT = 96;
const ANCHOR_GAP = 8;

export function calculateDictionaryPopoverLayout({
  windowWidth,
  windowHeight,
  anchor,
}: {
  windowWidth: number;
  windowHeight: number;
  anchor?: DictionaryPopoverLayoutAnchor;
}): { left: number; top: number; bodyHeight: number } {
  // Keep the body height independent from the resulting top position. Making
  // each depend on the other creates a layout feedback loop on Android, where
  // pixel rounding can move the popover up and down indefinitely.
  const bodyHeight = clamp(
    POPOVER_BODY_HEIGHT,
    120,
    windowHeight - BOTTOM_CHROME_HEIGHT - 92,
  );
  const cardHeight = POPOVER_ESTIMATED_HEIGHT - POPOVER_BODY_HEIGHT + bodyHeight;
  const maximumTop = Math.max(POPOVER_MARGIN, windowHeight - BOTTOM_CHROME_HEIGHT - cardHeight);
  const fallbackTop = clamp(windowHeight * 0.12, POPOVER_MARGIN, maximumTop);
  const fallbackLeft = Math.max(POPOVER_MARGIN, (windowWidth - DICTIONARY_POPOVER_WIDTH) / 2);
  if (!anchor) return { left: fallbackLeft, top: fallbackTop, bodyHeight };

  const left = clamp(
    anchor.pageX + anchor.width / 2 - DICTIONARY_POPOVER_WIDTH / 2,
    POPOVER_MARGIN,
    windowWidth - DICTIONARY_POPOVER_WIDTH - POPOVER_MARGIN,
  );
  const below = anchor.pageY + anchor.height + ANCHOR_GAP;
  const above = anchor.pageY - cardHeight - ANCHOR_GAP;
  const top = below <= maximumTop
    ? below
    : above >= POPOVER_MARGIN
      ? above
      : clamp(below, POPOVER_MARGIN, maximumTop);
  return { left, top, bodyHeight };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}
