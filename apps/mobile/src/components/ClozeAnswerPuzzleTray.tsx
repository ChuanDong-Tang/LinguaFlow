import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ClozeAnswerPuzzle, ClozeAnswerPuzzleToken } from "../domain/cloze/clozeAnswerPuzzle";
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
  const remove = (id: string) => {
    if (!disabled) onChange(selectedIds.filter((selectedId) => selectedId !== id));
  };
  const append = (id: string) => {
    if (!disabled) onChange([...selectedIds, id]);
  };
  return <View style={styles.root}>
    <View style={[styles.answer, incorrect && styles.answerIncorrect]}>
      {selected.length ? <View style={styles.wrap}>{selected.map((token) => <Pressable key={token.id} disabled={disabled} style={({ pressed }) => [styles.selectedTile, puzzle.mode === "characters" && styles.characterTile, pressed && styles.pressed]} onPress={() => remove(token.id)}><Text style={styles.selectedText}>{token.text}</Text></Pressable>)}</View> : <View style={styles.placeholderRow}>{puzzle.target.map((token) => <View key={token.id} style={[styles.placeholder, puzzle.mode === "words" && styles.wordPlaceholder]} />)}</View>}
    </View>
    <View style={styles.wrap}>{available.map((token) => <Pressable key={token.id} disabled={disabled} style={({ pressed }) => [styles.tile, puzzle.mode === "characters" && styles.characterTile, pressed && styles.pressed]} onPress={() => append(token.id)}><Text style={styles.tileText}>{token.text}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  answer: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, padding: 9, justifyContent: "center" },
  answerIncorrect: { borderColor: "#DFA9A3", backgroundColor: "#FFF6F4" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  placeholderRow: { minHeight: 32, flexDirection: "row", flexWrap: "wrap", gap: 7, justifyContent: "center", alignItems: "center" },
  placeholder: { width: 22, height: 2, borderRadius: 1, backgroundColor: theme.colors.border },
  wordPlaceholder: { width: 48 },
  tile: { minWidth: 48, minHeight: 42, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  selectedTile: { minWidth: 42, minHeight: 34, paddingHorizontal: 10, borderRadius: 11, backgroundColor: theme.colors.accentSoft, alignItems: "center", justifyContent: "center" },
  characterTile: { minWidth: 42, paddingHorizontal: 10 },
  tileText: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  selectedText: { color: theme.colors.accentStrong, fontSize: 17, fontWeight: "700" },
  pressed: { opacity: 0.68, transform: [{ scale: 0.97 }] },
});
