import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ClozeAnswerPuzzle, ClozeAnswerPuzzleToken } from "../domain/cloze/clozeAnswerPuzzle";
import { playSelectionFeedbackSound } from "../services/audio/gameFeedbackAudio";
import { theme } from "../theme";

export function ClozeAnswerPuzzleTray({
  puzzle,
  selectedIds,
  incorrect = false,
  disabled = false,
  onChange,
}: {
  puzzle: ClozeAnswerPuzzle;
  selectedIds: string[];
  incorrect?: boolean;
  disabled?: boolean;
  onChange: (selectedIds: string[]) => void;
}) {
  const selected = selectedIds
    .map((id) => puzzle.target.find((token) => token.id === id))
    .filter((token): token is ClozeAnswerPuzzleToken => Boolean(token));
  const selectedSet = new Set(selectedIds);
  const available = puzzle.shuffled.filter((token) => !selectedSet.has(token.id));
  const remaining = puzzle.target.slice(selected.length);
  const remove = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.filter((selectedId) => selectedId !== id));
    void playSelectionFeedbackSound().catch(() => undefined);
  };
  const append = (id: string) => {
    if (disabled) return;
    onChange([...selectedIds, id]);
    void playSelectionFeedbackSound().catch(() => undefined);
  };
  return <View style={styles.root}>
    <View style={[styles.answer, incorrect && styles.answerIncorrect]}>
      <View style={[styles.wrap, styles.answerWrap, puzzle.mode === "characters" && styles.characterAnswerWrap]}>
        {puzzle.fixedPrefix ? <Text style={styles.fixedPrefix}>{puzzle.fixedPrefix}</Text> : null}
        {selected.map((token) => <Pressable key={token.id} disabled={disabled} style={({ pressed }) => [styles.selectedTile, puzzle.mode === "characters" && styles.selectedCharacterTile, pressed && styles.pressed]} onPress={() => remove(token.id)}><Text style={[styles.selectedText, puzzle.mode === "characters" && styles.selectedCharacterText]}>{token.text}</Text></Pressable>)}
        {remaining.map((token) => <View key={token.id} style={[styles.placeholder, puzzle.mode === "words" && styles.wordPlaceholder]} />)}
      </View>
    </View>
    <View style={styles.wrap}>{available.map((token) => <Pressable key={token.id} disabled={disabled} style={({ pressed }) => [styles.tile, puzzle.mode === "characters" && styles.characterTile, pressed && styles.pressed]} onPress={() => append(token.id)}><Text style={styles.tileText}>{token.text}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  answer: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, padding: 9, justifyContent: "center" },
  answerIncorrect: { borderColor: "#DFA9A3", backgroundColor: "#FFF6F4" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  answerWrap: { minHeight: 32, alignItems: "center" },
  characterAnswerWrap: { gap: 4 },
  placeholder: { width: 18, height: 2, borderRadius: 1, backgroundColor: theme.colors.border },
  wordPlaceholder: { width: 48 },
  fixedPrefix: { color: theme.colors.textSecondary, fontSize: 18, lineHeight: 28, fontWeight: "600", letterSpacing: .3 },
  tile: { minWidth: 48, minHeight: 42, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  selectedTile: { minWidth: 42, minHeight: 34, paddingHorizontal: 10, borderRadius: 11, backgroundColor: theme.colors.accentSoft, alignItems: "center", justifyContent: "center" },
  selectedCharacterTile: { minWidth: 16, minHeight: 28, paddingHorizontal: 1, borderRadius: 0, backgroundColor: "transparent" },
  characterTile: { minWidth: 42, paddingHorizontal: 10 },
  tileText: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  selectedText: { color: theme.colors.accentStrong, fontSize: 17, fontWeight: "700" },
  selectedCharacterText: { color: theme.colors.text, fontSize: 18, lineHeight: 28, fontWeight: "600", letterSpacing: .3 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.97 }] },
});
