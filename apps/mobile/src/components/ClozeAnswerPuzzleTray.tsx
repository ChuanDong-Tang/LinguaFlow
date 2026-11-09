import React, { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import Reanimated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Text } from "./Typography";
import {
  EMPTY_SLOT,
  isClozeAnswerPuzzleComplete,
  placeClozeAnswerToken,
  removeClozeAnswerToken,
  type ClozeAnswerPuzzle,
} from "../domain/cloze/clozeAnswerPuzzle";
import { playSelectionFeedbackSound } from "../services/audio/gameFeedbackAudio";
import { haptic } from "../feedback/haptics";
import { motion } from "../motion";
import { CheckMark, PressableSurface } from "./surface/Surface";
import { OioMascot, type OioMascotHandle } from "./sketch/OioMascot";
import { t } from "../i18n";
import { theme } from "../theme";
import { createStyles } from "../styles";

export type ClozeChoiceFeedback = { correct: boolean; answer: string };

/**
 * Choice practice for one blank (skills/linguaflow-interaction-feel, "Memory
 * game feel"): place tokens into fixed slots, press 检查, then 继续 / 知道了.
 */
export function ClozeAnswerPuzzleTray({
  puzzle,
  selectedIds,
  incorrect = false,
  disabled = false,
  feedback = null,
  onChange,
  onCheck,
  onProceed,
}: {
  puzzle: ClozeAnswerPuzzle;
  selectedIds: string[];
  incorrect?: boolean;
  disabled?: boolean;
  feedback?: ClozeChoiceFeedback | null;
  onChange: (selectedIds: string[]) => void;
  onCheck?: () => void;
  onProceed?: () => void;
}) {
  const byId = new Map(puzzle.target.map((token) => [token.id, token]));
  const placed = new Set(selectedIds.filter((id) => id !== EMPTY_SLOT));
  const available = puzzle.shuffled.filter((token) => !placed.has(token.id));
  const answered = Boolean(feedback);
  const locked = disabled || answered;
  const complete = isClozeAnswerPuzzleComplete(puzzle, selectedIds);
  const words = puzzle.mode === "words";
  const mascot = useRef<OioMascotHandle>(null);
  useEffect(() => {
    if (!feedback) return;
    if (feedback.correct) mascot.current?.hop();
    else mascot.current?.tilt();
  }, [feedback]);

  const tap = () => {
    haptic.select();
    void playSelectionFeedbackSound().catch(() => undefined);
  };
  const remove = (id: string) => {
    if (locked) return;
    tap();
    onChange(removeClozeAnswerToken(selectedIds, id));
  };
  const place = (id: string) => {
    if (locked) return;
    tap();
    onChange(placeClozeAnswerToken(puzzle, selectedIds, id));
  };

  return <View style={styles.root}>
    <View style={[styles.answer, incorrect && !answered && styles.answerIncorrect]}>
      <View style={[styles.wrap, styles.answerWrap, !words && styles.characterAnswerWrap]}>
        {puzzle.fixedPrefix ? <Text style={styles.fixedPrefix}>{puzzle.fixedPrefix}</Text> : null}
        {puzzle.target.map((_, slot) => {
          const id = selectedIds[slot];
          const token = id && id !== EMPTY_SLOT ? byId.get(id) : undefined;
          return token
            ? <Pressable key={`slot-${slot}`} accessibilityRole="button" accessibilityLabel={token.text} disabled={locked} style={({ pressed }) => [styles.slotTile, !words && styles.slotCharacterTile, pressed && styles.pressed]} onPress={() => remove(token.id)}>
              <Text style={[styles.slotText, !words && styles.slotCharacterText]}>{token.text}</Text>
            </Pressable>
            : <View key={`slot-${slot}`} style={[styles.slotEmpty, words ? styles.slotEmptyWord : styles.slotEmptyCharacter]} />;
        })}
      </View>
    </View>
    {answered ? null : <View style={styles.wrap}>
      {available.map((token) => <Pressable key={token.id} accessibilityRole="button" accessibilityLabel={token.text} disabled={locked} style={({ pressed }) => [styles.tile, !words && styles.characterTile, pressed && styles.pressed]} onPress={() => place(token.id)}>
        <Text style={styles.tileText}>{token.text}</Text>
      </Pressable>)}
    </View>}
    {feedback ? <Reanimated.View entering={FadeInDown.duration(motion.duration.enter)} style={[styles.feedback, feedback.correct ? styles.feedbackCorrect : styles.feedbackIncorrect]}>
      <OioMascot ref={mascot} size={34} idle={false} />
      <View style={styles.feedbackText}>
        {feedback.correct
          ? <View style={styles.feedbackTitleRow}><CheckMark size={22} /><Text style={styles.feedbackTitle}>{t("cloze.feedback.correct")}</Text></View>
          : <>
            <Text style={styles.feedbackLabel}>{t("cloze.feedback.correct_answer")}</Text>
            <Text style={styles.feedbackAnswer}>{feedback.answer}</Text>
          </>}
      </View>
    </Reanimated.View> : null}
    <View style={styles.actions}>
      {!answered && placed.size > 0 ? <Reanimated.View entering={FadeIn.duration(motion.duration.quick)}>
        <Pressable accessibilityRole="button" disabled={locked} hitSlop={6} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]} onPress={() => { haptic.light(); onChange([]); }}>
          <Text style={styles.resetText}>{t("cloze.reset")}</Text>
        </Pressable>
      </Reanimated.View> : <View />}
      {onCheck && onProceed ? <PressableSurface
        radius={22}
        fill={answered || complete ? theme.colors.accent : theme.colors.fill2}
        feedback={null}
        disabled={disabled || (!answered && !complete)}
        accessibilityRole="button"
        style={styles.primary}
        contentStyle={styles.primaryInner}
        onPress={() => (answered ? onProceed() : onCheck())}
      >
        <Text style={[styles.primaryText, (answered || complete) && styles.primaryTextOn]}>
          {t(answered ? (feedback?.correct ? "cloze.continue" : "cloze.got_it") : "cloze.check")}
        </Text>
      </PressableSurface> : null}
    </View>
  </View>;
}

const styles = createStyles(() => ({
  root: { gap: 12 },
  answer: { minHeight: 60, borderRadius: 12, backgroundColor: theme.colors.fill1, padding: 10, justifyContent: "center" },
  answerIncorrect: { backgroundColor: theme.colors.fill2 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  answerWrap: { minHeight: 40, alignItems: "flex-end" },
  characterAnswerWrap: { gap: 4 },
  fixedPrefix: { color: theme.colors.textSecondary, fontSize: 20, lineHeight: 34, fontWeight: "600", letterSpacing: 0.3 },
  slotTile: { minWidth: 44, minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  slotCharacterTile: { minWidth: 30, paddingHorizontal: 6 },
  slotText: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  slotCharacterText: { fontSize: 20, letterSpacing: 0.3 },
  slotEmpty: { height: 40, borderBottomWidth: 2, borderColor: theme.colors.borderStrong, borderStyle: "dashed" },
  slotEmptyWord: { width: 56 },
  slotEmptyCharacter: { width: 26 },
  tile: { minWidth: 52, minHeight: 46, paddingHorizontal: 14, borderRadius: 10, backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center" },
  characterTile: { minWidth: 46, paddingHorizontal: 10 },
  tileText: { color: theme.colors.text, fontSize: 18, fontWeight: "600" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  feedback: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 },
  feedbackCorrect: { backgroundColor: theme.colors.accentSoft },
  feedbackIncorrect: { backgroundColor: theme.colors.fill2 },
  feedbackText: { flex: 1, gap: 2 },
  feedbackTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  feedbackTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  feedbackLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "600" },
  feedbackAnswer: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  resetButton: { minHeight: 44, paddingHorizontal: 6, justifyContent: "center" },
  resetText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: "600" },
  primary: { flexGrow: 0 },
  primaryInner: { minHeight: 46, minWidth: 128, paddingHorizontal: 26, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.colors.textMuted, fontSize: 16, fontWeight: "700" },
  primaryTextOn: { color: theme.colors.onAccent },
}));
