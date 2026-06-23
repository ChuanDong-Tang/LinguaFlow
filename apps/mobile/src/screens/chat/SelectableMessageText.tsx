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
  selectionMode?: "range" | "all";
  interactionsDisabled?: boolean;
  onInteractionStart?: () => void;
  onSelectionStart?: () => void;
  onSelectionChange?: (payload: NativeTextSelectionPayload) => void;
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

export const SelectableMessageText = React.forwardRef<SelectableMessageTextRef, Props>(
  function SelectableMessageText({
    text,
    style,
    highlightRanges,
    blankRanges,
    correctRanges,
    trailingElement,
    enableClozeMenu = true,
    selectionMode = "range",
    interactionsDisabled = false,
    onInteractionStart,
    onSelectionStart,
    onSelectionChange,
    onClozeRangePress,
    onClozeRangeLongPress,
  }, ref) {
    const renderStart = perfNow();
    const clozeMenuOption = t("cloze.menu");
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
    const nativeHighlightRangesJson = React.useMemo(() => rangesToJson(highlights), [highlights]);
    const nativeBlankRangesJson = React.useMemo(() => rangesToJson(blanks), [blanks]);
    const nativeCorrectRangesJson = React.useMemo(() => rangesToJson(correct), [correct]);
    const flattenedTextStyle = React.useMemo(() => StyleSheet.flatten(style) ?? {}, [style]);
    const nativeTextRef = React.useRef<React.ElementRef<typeof ChatSelectableTextView> | null>(null);

    const clearSelection = React.useCallback(() => {
      clearChatSelectableTextSelection(nativeTextRef);
    }, []);

    React.useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    const handleNativeSelection = React.useCallback(
      (event: { nativeEvent: ChatSelectableTextSelectionEvent }) => {
        const payload = event.nativeEvent;
        if (payload.chosenOption !== clozeMenuOption) return;
        const selectedText = payload.highlightedText;
        if (!selectedText) return;
        const hasNativeRange = typeof payload.selectionStart === "number" && typeof payload.selectionEnd === "number";
        const start = hasNativeRange ? payload.selectionStart! : text.indexOf(selectedText);
        if (start < 0) return;
        const end = hasNativeRange ? payload.selectionEnd! : start + selectedText.length;
        const selectedRange = { start: Math.min(start, end), end: Math.max(start, end) };
        const existingClozeRanges = highlights.length ? highlights : blanks;
        const insideExistingCloze = existingClozeRanges.some((range) => rangeContains(range, selectedRange.start, selectedRange.end));
        if (insideExistingCloze) return;
        const crossesExistingCloze = existingClozeRanges.some((range) => rangesOverlap(range, selectedRange));
        if (crossesExistingCloze) {
          Alert.alert(t("cloze.cross_existing"));
          return;
        }
        onSelectionStart?.();
        onSelectionChange?.({
          start: selectedRange.start,
          end: selectedRange.end,
          selectedText: text.slice(selectedRange.start, selectedRange.end),
        });
      },
      [blanks, clozeMenuOption, highlights, onSelectionChange, onSelectionStart, text],
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
    const nativeInteractionProps = Platform.select({
      ios: {
        selectionMode,
        menuOptions: enableClozeMenu ? [clozeMenuOption] : [],
        onSelectionStart,
        onSelection: handleNativeSelection,
        onClozeRangePress: handleClozeRangePress,
        onClozeRangeLongPress: handleClozeRangeLongPress,
      },
      default: {
        pointerEvents: interactionsDisabled ? "none" as const : "auto" as const,
        selectionMode,
        menuOptions: !interactionsDisabled && enableClozeMenu ? [clozeMenuOption] : [],
        onTouchStart: interactionsDisabled || !shouldNotifyInteractionOnTouchStart ? undefined : handleTouchStart,
        onSelectionStart: interactionsDisabled ? undefined : onSelectionStart,
        onSelection: interactionsDisabled ? undefined : handleNativeSelection,
        onClozeRangePress: interactionsDisabled ? undefined : handleClozeRangePress,
        onClozeRangeLongPress: interactionsDisabled ? undefined : handleClozeRangeLongPress,
      },
    });

    return (
      <View>
        <Text pointerEvents="none" style={[style, { opacity: 0 }]}>{nativeText}</Text>
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
          style={{ ...StyleSheet.absoluteFillObject }}
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
