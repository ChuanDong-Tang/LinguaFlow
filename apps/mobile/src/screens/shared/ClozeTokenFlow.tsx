import React, { useRef } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import type { ClozeToken } from "../../domain/cloze/clozeUtils";

export type ClozeFlowSegment =
  | { type: "text"; key: string; tokenIndex: number; text: string; highlighted: boolean; correct: boolean; spacer: boolean; spacerHighlighted: boolean; textStart: number; textEnd: number }
  | { type: "blank"; key: string; tokenIndex: number; width: number; spacer: boolean; spacerHighlighted: boolean; expectedText: string; textStart: number; textEnd: number };

export function buildClozeFlowSegments(input: {
  tokens: ClozeToken[];
  phraseTokenIndexes: number[];
  blankTokenIndexes: number[];
  correctTokenIndexes: number[];
}): ClozeFlowSegment[] {
  const phraseSet = new Set(input.phraseTokenIndexes);
  const blankSet = new Set(input.blankTokenIndexes);
  const correctSet = new Set(input.correctTokenIndexes);
  return input.tokens.map((token, index) => {
    const previous = input.tokens[index - 1];
    const spacer = Boolean(previous && token.kind === "word" && previous.kind === "word");
    const spacerHighlighted = Boolean(spacer && phraseSet.has(token.index) && previous && phraseSet.has(previous.index));
    if (blankSet.has(token.index) && !correctSet.has(token.index)) {
      return { type: "blank", key: `blank-${token.index}`, tokenIndex: token.index, width: Math.max(36, token.text.length * 10), spacer, spacerHighlighted, expectedText: token.text, textStart: token.start, textEnd: token.end };
    }
    return { type: "text", key: `text-${token.index}`, tokenIndex: token.index, text: token.text, highlighted: phraseSet.has(token.index) || correctSet.has(token.index), correct: blankSet.has(token.index) && correctSet.has(token.index), spacer, spacerHighlighted, textStart: token.start, textEnd: token.end };
  });
}

export function ClozeTokenFlow({ segments, answers, checkedAnswers, onChangeAnswer, onBlankFocus, onLookup }: {
  segments: ClozeFlowSegment[];
  answers: Record<number, string>;
  checkedAnswers: Record<number, "correct" | "incorrect">;
  onChangeAnswer: (tokenIndex: number, value: string) => void;
  onBlankFocus: (inputRef: TextInput | null) => void;
  onLookup?: (term: string, start: number, end: number) => void;
}) {
  return <>{segments.map((segment) => {
    const spacer = segment.spacer ? <Text style={segment.spacerHighlighted ? styles.phraseText : styles.text}> </Text> : null;
    if (segment.type === "text") return <React.Fragment key={segment.key}>{spacer}<Text onLongPress={onLookup ? (event) => { event.stopPropagation(); onLookup(segment.text, segment.textStart, segment.textEnd); } : undefined} style={[styles.text, segment.highlighted && styles.phraseText, segment.correct && styles.correctText]}>{segment.text}</Text></React.Fragment>;
    const checked = checkedAnswers[segment.tokenIndex];
    const answer = answers[segment.tokenIndex] ?? "";
    return <React.Fragment key={segment.key}>{spacer}{checked === "correct"
      ? <Text style={[styles.text, styles.correctText]}>{answer || segment.expectedText}</Text>
      : checked === "incorrect"
        ? <Text style={[styles.text, styles.phraseText, styles.incorrectText]}>{segment.expectedText}</Text>
        : <BlankInput segment={segment} answer={answer} onChangeAnswer={onChangeAnswer} onFocus={onBlankFocus} />}</React.Fragment>;
  })}</>;
}

function BlankInput({ segment, answer, onChangeAnswer, onFocus }: {
  segment: Extract<ClozeFlowSegment, { type: "blank" }>;
  answer: string;
  onChangeAnswer: (tokenIndex: number, value: string) => void;
  onFocus: (inputRef: TextInput | null) => void;
}) {
  const inputRef = useRef<TextInput | null>(null);
  return <TextInput ref={inputRef} style={[styles.blankInput, { width: segment.width }]} value={answer} onFocus={() => onFocus(inputRef.current)} onPressIn={(event) => event.stopPropagation()} onChangeText={(value) => onChangeAnswer(segment.tokenIndex, value)} autoCapitalize="none" autoCorrect={false} />;
}

const styles = StyleSheet.create({
  text: { color: "#080808", fontSize: 16, lineHeight: 24, fontWeight: "400", includeFontPadding: false },
  phraseText: { backgroundColor: "#FFF2B8", color: "#080808" },
  correctText: { color: "#6FAE78" },
  incorrectText: { color: "#D64545", fontWeight: "500" },
  blankInput: { height: 24, marginHorizontal: 0, paddingHorizontal: 1, paddingVertical: 0, backgroundColor: "#FFF2B8", borderBottomWidth: 1, borderBottomColor: "#111111", color: "#111111", fontSize: 16, lineHeight: 22, fontWeight: "400", textAlign: "center", textAlignVertical: "center", includeFontPadding: false },
});
