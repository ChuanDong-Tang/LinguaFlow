import React from "react";
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import {
  ChatSelectableTextView,
  clearChatSelectableTextSelection,
  type ChatSelectableTextRangeEvent,
  type ChatSelectableTextSelectionEvent,
} from "./ChatSelectableTextView";
import { t } from "../../i18n";

export type NativeTextSelectionPayload = {
  start: number;
  end: number;
  selectedText: string;
  selectionRect?: {
    pageX: number;
    pageY: number;
    width: number;
    height: number;
  };
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
  trailingElement?: React.ReactNode;
  enableClozeMenu?: boolean;
  enableDictionaryMenu?: boolean;
  selectionMode?: "range" | "all";
  interactionsDisabled?: boolean;
  onInteractionStart?: () => void;
  onSelectionStart?: () => void;
  onSelectionChange?: (payload: NativeTextSelectionPayload) => void;
  onDictionarySelection?: (payload: NativeTextSelectionPayload) => void;
  onClozeRangePress?: (groupIndex: number) => void;
  onClozeRangeLongPress?: (groupIndex: number) => void;
};

const SELECTABLE_TEXT_PERF_LOGS = false;
const SLOW_SELECTABLE_TEXT_MS = 12;
const LONG_SELECTABLE_TEXT_CHARS = 600;
const shouldNotifyInteractionOnTouchStart = Platform.OS === "android";
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

function rangesToJson(ranges?: Array<NativeClozeHighlightRange | NativeClozeBlankRange>): string {
  return JSON.stringify(ranges ?? []);
}

function visibleTextForBlanks(text: string, blankRanges: NativeClozeBlankRange[]): string {
  if (blankRanges.length === 0) return text;
  const chars = text.split("");
  for (const range of blankRanges) {
    const start = Math.max(0, Math.min(range.start, chars.length));
    const end = Math.max(start, Math.min(range.end, chars.length));
    for (let index = start; index < end; index += 1) {
      if (!/\s/.test(chars[index])) chars[index] = "_";
    }
  }
  return chars.join("");
}

function normalizeLayoutHeight(value: number): number {
  return typeof value === "number" && value > 0 && value < Infinity ? Math.ceil(value) : 0;
}

function isDictionaryWordChar(char: string): boolean {
  return /[A-Za-z0-9']/.test(char);
}

function expandSelectionToWord(text: string, start: number, end: number): NativeClozeBlankRange {
  let safeStart = Math.max(0, Math.min(start, text.length));
  let safeEnd = Math.max(safeStart, Math.min(end, text.length));
  while (safeStart < safeEnd && /\s/.test(text[safeStart])) safeStart += 1;
  while (safeEnd > safeStart && /\s/.test(text[safeEnd - 1])) safeEnd -= 1;
  if (safeStart >= safeEnd) return { start: safeStart, end: safeEnd };
  const selected = text.slice(safeStart, safeEnd);
  if (!/[A-Za-z0-9]/.test(selected)) return { start: safeStart, end: safeEnd };
  while (safeStart > 0 && isDictionaryWordChar(text[safeStart - 1])) safeStart -= 1;
  while (safeEnd < text.length && isDictionaryWordChar(text[safeEnd])) safeEnd += 1;
  return { start: safeStart, end: safeEnd };
}

function findContainingHighlightRange(
  ranges: Required<NativeClozeHighlightRange>[],
  start: number,
  end: number,
): NativeClozeBlankRange | null {
  return ranges.find((range) => range.start <= start && range.end >= end) ?? null;
}

function renderLayoutTextSegments(
  text: string,
  highlightRanges: NativeClozeHighlightRange[],
  textStyle: StyleProp<TextStyle>,
): React.ReactNode {
  if (highlightRanges.length === 0) return text;
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  highlightRanges.forEach((range, index) => {
    const start = Math.max(cursor, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));
    if (cursor < start) {
      segments.push(<Text key={`normal-${index}-${cursor}`} style={textStyle}>{text.slice(cursor, start)}</Text>);
    }
    if (start < end) {
      segments.push(
        <Text key={`highlight-${index}-${start}`} style={textStyle}>
          {text.slice(start, end)}
        </Text>,
      );
    }
    cursor = end;
  });
  if (cursor < text.length) {
    segments.push(<Text key={`normal-end-${cursor}`} style={textStyle}>{text.slice(cursor)}</Text>);
  }
  return segments;
}

export const SelectableMessageText = React.forwardRef<SelectableMessageTextRef, Props>(
  function SelectableMessageText({
    text,
    style,
    highlightRanges,
    blankRanges,
    correctRanges,
    trailingElement,
    enableClozeMenu = true,
    enableDictionaryMenu = false,
    selectionMode = "range",
    interactionsDisabled = false,
    onInteractionStart,
    onSelectionStart,
    onSelectionChange,
    onDictionarySelection,
    onClozeRangePress,
    onClozeRangeLongPress,
  }, ref) {
    const renderStart = perfNow();
    const clozeMenuOption = t("cloze.menu");
    const dictionaryMenuOption = t("dictionary.menu");
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
    const correct = React.useMemo(() => normalizeBlankRanges(text, correctRanges), [correctRanges, text]);
    const nativeText = React.useMemo(() => {
      const trailingText = typeof trailingElement === "string" ? trailingElement : "";
      return trailingText ? `${text}${trailingText}` : text;
    }, [text, trailingElement]);
    const layoutText = React.useMemo(() => visibleTextForBlanks(nativeText, blanks), [blanks, nativeText]);
    const nativeHighlightRangesJson = React.useMemo(() => rangesToJson(highlights), [highlights]);
    const nativeBlankRangesJson = React.useMemo(() => rangesToJson(blanks), [blanks]);
    const nativeCorrectRangesJson = React.useMemo(() => rangesToJson(correct), [correct]);
    const flattenedTextStyle = React.useMemo(() => StyleSheet.flatten(style) ?? {}, [style]);
    const nativeTextRef = React.useRef<React.ElementRef<typeof ChatSelectableTextView> | null>(null);
    const [nativeContentHeight, setNativeContentHeight] = React.useState(0);

    const clearSelection = React.useCallback(() => {
      clearChatSelectableTextSelection(nativeTextRef);
    }, []);

    React.useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    const handleNativeSelection = React.useCallback(
      (event: { nativeEvent: ChatSelectableTextSelectionEvent }) => {
        const payload = event.nativeEvent;
        if (payload.chosenOption !== clozeMenuOption && payload.chosenOption !== dictionaryMenuOption) return;
        const selectedText = payload.highlightedText;
        if (!selectedText) return;
        const hasNativeRange = typeof payload.selectionStart === "number" && typeof payload.selectionEnd === "number";
        const start = hasNativeRange ? payload.selectionStart! : text.indexOf(selectedText);
        if (start < 0) return;
        const end = hasNativeRange ? payload.selectionEnd! : start + selectedText.length;
        const selectedRange = { start: Math.min(start, end), end: Math.max(start, end) };
        if (payload.chosenOption === dictionaryMenuOption) {
          const expandedRange =
            findContainingHighlightRange(highlights, selectedRange.start, selectedRange.end) ??
            expandSelectionToWord(text, selectedRange.start, selectedRange.end);
          if (expandedRange.start >= expandedRange.end) return;
          onSelectionStart?.();
          onDictionarySelection?.({
            start: expandedRange.start,
            end: expandedRange.end,
            selectedText: text.slice(expandedRange.start, expandedRange.end),
            selectionRect: payload.selectionRect,
          });
          return;
        }
        const normalizedPayload = {
          start: selectedRange.start,
          end: selectedRange.end,
          selectedText: text.slice(selectedRange.start, selectedRange.end),
          selectionRect: payload.selectionRect,
        };
        const existingClozeRanges = highlights.length ? highlights : blanks;
        const insideExistingCloze = existingClozeRanges.some((range) => rangeContains(range, selectedRange.start, selectedRange.end));
        if (insideExistingCloze) return;
        const crossesExistingCloze = existingClozeRanges.some((range) => rangesOverlap(range, selectedRange));
        if (crossesExistingCloze) {
          Alert.alert(t("cloze.cross_existing"));
          return;
        }
        onSelectionStart?.();
        onSelectionChange?.(normalizedPayload);
      },
      [blanks, clozeMenuOption, dictionaryMenuOption, highlights, onDictionarySelection, onSelectionChange, onSelectionStart, text],
    );
    const handleClozeRangePress = React.useCallback(
      (event: { nativeEvent: ChatSelectableTextRangeEvent }) => {
        onClozeRangePress?.(event.nativeEvent.groupIndex);
      },
      [onClozeRangePress],
    );
    const handleClozeRangeLongPress = React.useCallback(
      (event: { nativeEvent: ChatSelectableTextRangeEvent }) => {
        onClozeRangeLongPress?.(event.nativeEvent.groupIndex);
      },
      [onClozeRangeLongPress],
    );
    React.useEffect(() => {
      logSelectableTextPerf("render+commit", renderStart, {
        textLength: text.length,
        blankRanges: blanks.length,
      });
    });
    const handleTouchStart = React.useCallback(() => {
      onInteractionStart?.();
    }, [onInteractionStart]);
    const handleNativeContentHeightChange = React.useCallback((event: { nativeEvent: { height: number } }) => {
      const nextHeight = normalizeLayoutHeight(event.nativeEvent.height);
      setNativeContentHeight((current) => (Math.abs(current - nextHeight) < 1 ? current : nextHeight));
    }, []);
    const layoutBaseTextStyle = React.useMemo(
      () => [style, styles.layoutText],
      [style],
    );
    const layoutTextContent = React.useMemo(
      () => renderLayoutTextSegments(layoutText, highlights, layoutBaseTextStyle),
      [highlights, layoutBaseTextStyle, layoutText],
    );
    const nativeInteractionProps = Platform.select({
      ios: {
        selectionMode,
        menuOptions: [
          ...(enableDictionaryMenu ? [dictionaryMenuOption] : []),
          ...(enableClozeMenu ? [clozeMenuOption] : []),
        ],
        onContentHeightChange: handleNativeContentHeightChange,
        onSelectionStart,
        onSelection: handleNativeSelection,
        onClozeRangePress: handleClozeRangePress,
        onClozeRangeLongPress: handleClozeRangeLongPress,
      },
      default: {
        pointerEvents: interactionsDisabled ? "none" as const : "auto" as const,
        selectionMode,
        menuOptions: !interactionsDisabled
          ? [
            ...(enableDictionaryMenu ? [dictionaryMenuOption] : []),
            ...(enableClozeMenu ? [clozeMenuOption] : []),
          ]
          : [],
        onTouchStart: interactionsDisabled || !shouldNotifyInteractionOnTouchStart ? undefined : handleTouchStart,
        onSelectionStart: interactionsDisabled ? undefined : onSelectionStart,
        onSelection: interactionsDisabled ? undefined : handleNativeSelection,
        onClozeRangePress: interactionsDisabled ? undefined : handleClozeRangePress,
        onClozeRangeLongPress: interactionsDisabled ? undefined : handleClozeRangeLongPress,
      },
    });

    return (
      <View style={[styles.nativeTextContainer, nativeContentHeight > 0 ? { minHeight: nativeContentHeight } : null]}>
        <Text pointerEvents="none" style={layoutBaseTextStyle}>
          {layoutTextContent}
        </Text>
        <ChatSelectableTextView
          ref={nativeTextRef}
          text={nativeText}
          highlightRangesJson={nativeHighlightRangesJson}
          blankRangesJson={nativeBlankRangesJson}
          correctRangesJson={nativeCorrectRangesJson}
          answersVisible={false}
          textColor={typeof flattenedTextStyle.color === "string" ? flattenedTextStyle.color : "#111111"}
          fontSize={typeof flattenedTextStyle.fontSize === "number" ? flattenedTextStyle.fontSize : 17}
          lineHeight={typeof flattenedTextStyle.lineHeight === "number" ? flattenedTextStyle.lineHeight : 25}
          fontWeight={
            typeof flattenedTextStyle.fontWeight === "string"
              ? flattenedTextStyle.fontWeight
              : typeof flattenedTextStyle.fontWeight === "number"
                ? String(flattenedTextStyle.fontWeight)
                : undefined
          }
          style={styles.nativeTextView}
          {...nativeInteractionProps}
        />
        {Platform.OS !== "ios" && interactionsDisabled ? (
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => Keyboard.dismiss()}
          />
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  nativeTextContainer: {
    alignSelf: "stretch",
    position: "relative",
  },
  nativeTextView: {
    ...StyleSheet.absoluteFillObject,
  },
  layoutText: {
    color: "transparent",
  },
});
