import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

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
  onSelectionChange?: (payload: NativeTextSelectionPayload) => void;
  onClozeRangePress?: (groupIndex: number) => void;
  onClozeRangeLongPress?: (groupIndex: number) => void;
};

type TextPart =
  | {
      kind: "selectable";
      text: string;
      start: number;
      end: number;
      segmentIndex: number;
      tokens: SelectableToken[];
    }
  | {
      kind: "blocked";
      text: string;
      start: number;
      end: number;
      groupIndex: number;
    };

type SelectableToken = {
  kind: "word" | "text";
  text: string;
  start: number;
  end: number;
  segmentIndex: number;
  wordIndex: number | null;
};

type SelectionDraft = {
  segmentIndex: number;
  startWordIndex: number;
  endWordIndex: number;
  isComplete: boolean;
};

const WORD_RE = /[\p{L}\p{N}'’-]+/gu;

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

function renderTextWithBlanks(
  value: string,
  offset: number,
  blankRanges: NativeClozeBlankRange[],
  keyPrefix: string,
  textStyle?: StyleProp<TextStyle>,
) {
  const nodes: React.ReactNode[] = [];
  let cursor = offset;
  const end = offset + value.length;
  const visibleBlanks = blankRanges.filter((range) => range.end > offset && range.start < end);

  visibleBlanks.forEach((range, index) => {
    const start = Math.max(offset, range.start);
    const blankEnd = Math.min(end, range.end);
    if (start > cursor) {
      nodes.push(
        <Text key={`${keyPrefix}:text:${index}`} style={textStyle}>
          {value.slice(cursor - offset, start - offset)}
        </Text>,
      );
    }
    nodes.push(
      <Text key={`${keyPrefix}:blank:${index}`} style={[textStyle, styles.blankText]}>
        {"_".repeat(Math.max(1, blankEnd - start))}
      </Text>,
    );
    cursor = blankEnd;
  });

  if (cursor < end) {
    nodes.push(
      <Text key={`${keyPrefix}:tail`} style={textStyle}>
        {value.slice(cursor - offset)}
      </Text>,
    );
  }
  return nodes.length ? nodes : value;
}

function tokenizeSelectableSegment(value: string, offset: number, segmentIndex: number): SelectableToken[] {
  const tokens: SelectableToken[] = [];
  let cursor = 0;
  let wordIndex = 0;

  for (const match of value.matchAll(WORD_RE)) {
    const word = match[0] ?? "";
    const localStart = match.index ?? 0;
    if (localStart > cursor) {
      tokens.push({
        kind: "text",
        text: value.slice(cursor, localStart),
        start: offset + cursor,
        end: offset + localStart,
        segmentIndex,
        wordIndex: null,
      });
    }
    tokens.push({
      kind: "word",
      text: word,
      start: offset + localStart,
      end: offset + localStart + word.length,
      segmentIndex,
      wordIndex,
    });
    cursor = localStart + word.length;
    wordIndex += 1;
  }

  if (cursor < value.length) {
    tokens.push({
      kind: "text",
      text: value.slice(cursor),
      start: offset + cursor,
      end: offset + value.length,
      segmentIndex,
      wordIndex: null,
    });
  }

  return tokens;
}

function buildTextParts(text: string, highlightRanges?: NativeClozeHighlightRange[]): TextPart[] {
  const blockedRanges = normalizeBlockedRanges(text, highlightRanges);
  const parts: TextPart[] = [];
  let cursor = 0;
  let segmentIndex = 0;

  for (const range of blockedRanges) {
    if (range.start > cursor) {
      const segmentText = text.slice(cursor, range.start);
      parts.push({
        kind: "selectable",
        text: segmentText,
        start: cursor,
        end: range.start,
        segmentIndex,
        tokens: tokenizeSelectableSegment(segmentText, cursor, segmentIndex),
      });
      segmentIndex += 1;
    }
    parts.push({
      kind: "blocked",
      text: text.slice(range.start, range.end),
      start: range.start,
      end: range.end,
      groupIndex: range.groupIndex,
    });
    cursor = range.end;
  }

  if (cursor < text.length) {
    const segmentText = text.slice(cursor);
    parts.push({
      kind: "selectable",
      text: segmentText,
      start: cursor,
      end: text.length,
      segmentIndex,
      tokens: tokenizeSelectableSegment(segmentText, cursor, segmentIndex),
    });
  }

  return parts;
}

function getSelectedWordBounds(selection: SelectionDraft): [number, number] {
  return [
    Math.min(selection.startWordIndex, selection.endWordIndex),
    Math.max(selection.startWordIndex, selection.endWordIndex),
  ];
}

export const SelectableMessageText = React.forwardRef<SelectableMessageTextRef, Props>(
  function SelectableMessageText({
    text,
    style,
    highlightRanges,
    blankRanges,
    onSelectionChange,
    onClozeRangePress,
    onClozeRangeLongPress,
  }, ref) {
    const [selection, setSelection] = React.useState<SelectionDraft | null>(null);
    const parts = React.useMemo(() => buildTextParts(text, highlightRanges), [highlightRanges, text]);
    const blanks = React.useMemo(() => normalizeBlankRanges(text, blankRanges), [blankRanges, text]);

    const clearSelection = React.useCallback(() => {
      setSelection(null);
    }, []);

    React.useImperativeHandle(ref, () => ({ clearSelection }), [clearSelection]);

    const selectedRange = React.useMemo(() => {
      if (!selection) return null;
      if (!selection.isComplete) return null;
      const part = parts.find((item) => item.kind === "selectable" && item.segmentIndex === selection.segmentIndex);
      if (!part || part.kind !== "selectable") return null;
      const [firstWord, lastWord] = getSelectedWordBounds(selection);
      const selectedWords = part.tokens.filter(
        (token) => token.kind === "word" && token.wordIndex !== null && token.wordIndex >= firstWord && token.wordIndex <= lastWord,
      );
      if (!selectedWords.length) return null;
      return {
        start: selectedWords[0].start,
        end: selectedWords[selectedWords.length - 1].end,
      };
    }, [parts, selection]);

    const handleWordPress = React.useCallback((token: SelectableToken) => {
      if (token.kind !== "word" || token.wordIndex === null) return;
      const wordIndex = token.wordIndex;
      setSelection((current) => {
        if (!current || current.segmentIndex !== token.segmentIndex) {
          return {
            segmentIndex: token.segmentIndex,
            startWordIndex: wordIndex,
            endWordIndex: wordIndex,
            isComplete: false,
          };
        }
        return {
          ...current,
          endWordIndex: wordIndex,
          isComplete: true,
        };
      });
    }, []);

    React.useEffect(() => {
      if (!selectedRange) return;
      const timer = setTimeout(() => {
        onSelectionChange?.({
          start: selectedRange.start,
          end: selectedRange.end,
          selectedText: text.slice(selectedRange.start, selectedRange.end),
        });
      }, 0);
      return () => clearTimeout(timer);
    }, [onSelectionChange, selectedRange, text]);

    const renderSelectableToken = (token: SelectableToken, index: number) => {
      if (token.kind !== "word" || token.wordIndex === null) {
        return (
          <Text key={`${token.start}:${index}`}>
            {renderTextWithBlanks(token.text, token.start, blanks, `${token.start}:${index}`)}
          </Text>
        );
      }

      const active =
        selection?.segmentIndex === token.segmentIndex &&
        token.wordIndex >= getSelectedWordBounds(selection)[0] &&
        token.wordIndex <= getSelectedWordBounds(selection)[1];

      return (
        <Text
          key={`${token.start}:${index}`}
          suppressHighlighting
          style={active ? styles.selectedWordText : undefined}
          onPress={() => handleWordPress(token)}
        >
          {token.text}
        </Text>
      );
    };

    return (
      <View>
        <Text style={style}>
          {parts.map((part, index) => {
            if (part.kind === "blocked") {
              return (
                <Text
                  key={`${part.start}:${index}`}
                  suppressHighlighting
                  style={styles.blockedRangeText}
                  onPress={() => onClozeRangePress?.(part.groupIndex)}
                  onLongPress={() => onClozeRangeLongPress?.(part.groupIndex)}
                >
                  {renderTextWithBlanks(part.text, part.start, blanks, `${part.start}:${index}`, styles.blockedRangeText)}
                </Text>
              );
            }

            return (
              <Text key={`${part.start}:${index}`}>
                {part.tokens.map((token, tokenIndex) => renderSelectableToken(token, tokenIndex))}
              </Text>
            );
          })}
        </Text>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  blockedRangeText: {
    backgroundColor: "#FFF0B8",
    color: "#3D3420",
  },
  selectedWordText: {
    backgroundColor: "#DCEBFF",
    color: "#0D47A1",
  },
  blankText: {
    letterSpacing: 0,
  },
});
