import React from "react";
import {
  Alert,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { SelectableTextView } from "@rob117/react-native-selectable-text";

export type NativeTextSelectionPayload = {
  start: number;
  end: number;
  selectedText: string;
};

export type NativeClozeHighlightRange = {
  start: number;
  end: number;
  groupIndex?: number;
};

export type NativeClozeBlankRange = {
  start: number;
  end: number;
};

export type SelectableMessageTextRef = {
  clearSelection: () => void;
};

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  highlightRanges?: NativeClozeHighlightRange[];
  blankRanges?: NativeClozeBlankRange[];
  correctRanges?: NativeClozeBlankRange[];
  onSelectionStart?: () => void;
  onSelectionChange?: (payload: NativeTextSelectionPayload) => void;
  onClozeRangePress?: (groupIndex: number) => void;
  onClozeRangeLongPress?: (groupIndex: number) => void;
};

const SELECTABLE_TEXT_PERF_LOGS = true;
const SLOW_SELECTABLE_TEXT_MS = 12;
const LONG_SELECTABLE_TEXT_CHARS = 600;
const CLOZE_MENU_OPTION = "填空";
const CLOZE_BLANK_BACKGROUND = "#FFF0B8";

function perfNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function logSelectableTextPerf(label: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!SELECTABLE_TEXT_PERF_LOGS) return;
  const elapsedMs = perfNow() - startedAt;
  const textLength = typeof extra?.textLength === "number" ? extra.textLength : 0;
  if (elapsedMs < SLOW_SELECTABLE_TEXT_MS && textLength < LONG_SELECTABLE_TEXT_CHARS) return;
  const elapsed = elapsedMs.toFixed(1);
  if (extra) {
    console.log(`[selectable-text-perf] ${label}: ${elapsed}ms`, extra);
    return;
  }
  console.log(`[selectable-text-perf] ${label}: ${elapsed}ms`);
}

type RenderSegment = {
  start: number;
  end: number;
  text: string;
  groupIndex: number | null;
  isBlank: boolean;
  isCorrect: boolean;
};

function clampRange(range: NativeClozeHighlightRange, textLength: number): NativeClozeHighlightRange | null {
  const start = Math.max(0, Math.min(range.start, textLength));
  const end = Math.max(start, Math.min(range.end, textLength));
  if (start >= end) return null;
  return { start, end, groupIndex: range.groupIndex };
}

function normalizeBlockedRanges(text: string, ranges?: NativeClozeHighlightRange[]): Required<NativeClozeHighlightRange>[] {
  return (ranges ?? [])
    .map((range, index) => {
      const clamped = clampRange(range, text.length);
      if (!clamped) return null;
      return {
        start: clamped.start,
        end: clamped.end,
        groupIndex: clamped.groupIndex ?? index,
      };
    })
    .filter((range): range is Required<NativeClozeHighlightRange> => !!range)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<Required<NativeClozeHighlightRange>[]>((kept, range) => {
      const previous = kept[kept.length - 1];
      if (previous && range.start < previous.end) return kept;
      kept.push(range);
      return kept;
    }, []);
}

function normalizeBlankRanges(text: string, ranges?: NativeClozeBlankRange[]): NativeClozeBlankRange[] {
  return (ranges ?? [])
    .map((range) => {
      const start = Math.max(0, Math.min(range.start, text.length));
      const end = Math.max(start, Math.min(range.end, text.length));
      return start < end ? { start, end } : null;
    })
    .filter((range): range is NativeClozeBlankRange => !!range)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function rangeContains(range: NativeClozeBlankRange, start: number, end: number): boolean {
  return range.start <= start && range.end >= end;
}

function rangesOverlap(left: NativeClozeBlankRange, right: NativeClozeBlankRange): boolean {
  return left.start < right.end && left.end > right.start;
}

function buildRenderSegments(
  text: string,
  highlightRanges: Required<NativeClozeHighlightRange>[],
  blankRanges: NativeClozeBlankRange[],
  correctRanges: NativeClozeBlankRange[],
): RenderSegment[] {
  const boundaries = new Set<number>([0, text.length]);
  for (const range of [...highlightRanges, ...blankRanges, ...correctRanges]) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);

  // 只按已有 range 边界切片，不按词拆分；这样 cloze 越多才越多段，普通长文本始终很轻。
  return sorted.slice(0, -1).flatMap((start, index) => {
    const end = sorted[index + 1];
    if (start >= end) return [];
    const highlight = highlightRanges.find((range) => rangeContains(range, start, end));
    return [{
      start,
      end,
      text: text.slice(start, end),
      groupIndex: highlight?.groupIndex ?? null,
      isBlank: blankRanges.some((range) => rangeContains(range, start, end)),
      isCorrect: correctRanges.some((range) => rangeContains(range, start, end)),
    }];
  });
}

export const SelectableMessageText = React.forwardRef<SelectableMessageTextRef, Props>(
  function SelectableMessageText({
    text,
    style,
    highlightRanges,
    blankRanges,
    correctRanges,
    onSelectionStart,
    onSelectionChange,
    onClozeRangePress,
    onClozeRangeLongPress,
  }, ref) {
    const renderStart = perfNow();
    const highlights = React.useMemo(() => normalizeBlockedRanges(text, highlightRanges), [highlightRanges, text]);
    const blanks = React.useMemo(() => {
      const startedAt = perfNow();
      const value = normalizeBlankRanges(text, blankRanges);
      logSelectableTextPerf("normalize blank ranges", startedAt, {
        textLength: text.length,
        ranges: value.length,
      });
      return value;
    }, [blankRanges, text]);
    const correct = React.useMemo(() => {
      const startedAt = perfNow();
      const value = normalizeBlankRanges(text, correctRanges);
      logSelectableTextPerf("normalize correct ranges", startedAt, {
        textLength: text.length,
        ranges: value.length,
      });
      return value;
    }, [correctRanges, text]);
    const segments = React.useMemo(() => {
      const startedAt = perfNow();
      const value = buildRenderSegments(text, highlights, blanks, correct);
      logSelectableTextPerf("build render segments", startedAt, {
        textLength: text.length,
        highlightRanges: highlights.length,
        blankRanges: blanks.length,
        correctRanges: correct.length,
        segments: value.length,
      });
      return value;
    }, [blanks, correct, highlights, text]);

    const clearSelection = React.useCallback(() => undefined, []);

    React.useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    const handleNativeSelection = React.useCallback(
      (event: { chosenOption: string; highlightedText: string; selectionStart?: number; selectionEnd?: number }) => {
        if (event.chosenOption !== CLOZE_MENU_OPTION) return;
        const selectedText = event.highlightedText;
        if (!selectedText) return;
        const hasNativeRange = typeof event.selectionStart === "number" && typeof event.selectionEnd === "number";
        const start = hasNativeRange ? event.selectionStart! : text.indexOf(selectedText);
        if (start < 0) return;
        const end = hasNativeRange ? event.selectionEnd! : start + selectedText.length;
        console.log("[selectable-text-selection]", {
          source: hasNativeRange ? "native" : "fallback",
          start,
          end,
          selectedText,
        });
        const selectedRange = { start: Math.min(start, end), end: Math.max(start, end) };
        const existingClozeRanges = highlights.length ? highlights : blanks;
        const insideExistingCloze = existingClozeRanges.some((range) => rangeContains(range, selectedRange.start, selectedRange.end));
        if (insideExistingCloze) return;
        const crossesExistingCloze = existingClozeRanges.some((range) => rangesOverlap(range, selectedRange));
        if (crossesExistingCloze) {
          Alert.alert("不能跨过已有填空");
          return;
        }
        onSelectionStart?.();
        onSelectionChange?.({
          start: selectedRange.start,
          end: selectedRange.end,
          selectedText: text.slice(selectedRange.start, selectedRange.end),
        });
      },
      [blanks, highlights, onSelectionChange, onSelectionStart, text],
    );

    React.useEffect(() => {
      logSelectableTextPerf("render+commit", renderStart, {
        textLength: text.length,
        segments: segments.length,
        blankRanges: blanks.length,
        correctRanges: correct.length,
      });
    });

    return (
      <SelectableTextView menuOptions={[CLOZE_MENU_OPTION]} onSelection={handleNativeSelection}>
        <Text style={style}>
          {segments.map((segment, index) => {
            const segmentStyle = [
              segment.groupIndex !== null && styles.clozeRangeText,
              segment.isBlank && styles.blankText,
              segment.isCorrect && styles.correctText,
            ];
            return (
              <Text
                key={`${segment.start}:${index}`}
                suppressHighlighting
                style={segmentStyle}
                onPress={segment.groupIndex !== null ? () => onClozeRangePress?.(segment.groupIndex!) : undefined}
                onLongPress={segment.groupIndex !== null ? () => onClozeRangeLongPress?.(segment.groupIndex!) : undefined}
              >
                {segment.text}
              </Text>
            );
          })}
        </Text>
      </SelectableTextView>
    );
  },
);

const styles = StyleSheet.create({
  clozeRangeText: {
    backgroundColor: CLOZE_BLANK_BACKGROUND,
    color: "#3D3420",
  },
  blankText: {
    color: CLOZE_BLANK_BACKGROUND,
    textDecorationLine: "underline",
    textDecorationColor: "#8C6D1F",
    textShadowColor: CLOZE_BLANK_BACKGROUND,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  correctText: {
    color: "#6FAE78",
  },
});
