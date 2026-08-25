import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n";
import {
  CardApiError,
  getCardMemoryRoundCandidates,
  getCardSegmentAudio,
  saveCardClozeUpdate,
  validateCardMemoryRoundCandidates,
  type CardClozeBlank,
  type CardLearningContentType,
  type CardMemoryRoundCandidate,
} from "../services/api/cardApi";
import { playTtsAudio } from "../services/tts/ttsPlayback";
import { getSession } from "../services/auth/authStorage";
import { theme } from "../theme";
import { canBuildMemorySentencePuzzle, isDenseMemoryCloze, memorySentenceTokens, sameMemoryLanguageFamily } from "./memoryRoundRules";

export const MEMORY_ROUND_STORAGE_KEY = "linguaflow.memory_round.active.v2";
const MEMORY_ROUND_PENDING_KEY = "linguaflow.memory_round.pending.v1";
const MAX_QUESTIONS = 8;
let memoryRoundStorageQueue: Promise<void> = Promise.resolve();

type MemoryQuestion = {
  id: string;
  recordId: string;
  title: string;
  languageCode: string;
  thumbnailUrl: string | null;
  contentType: CardLearningContentType | null;
  contentVersion: string | null;
  clozeVersion: number;
  segmentId: string;
  blankIds: string[];
  sentence: string;
  kind: "choice" | "sentence";
  before: string;
  answer: string;
  after: string;
  options: string[];
  tokens: Array<{ id: string; text: string }>;
  selectedTokenIds: string[];
  disabledOptions: string[];
  firstAttemptCorrect: boolean | null;
  resultSynced: boolean;
  completed: boolean;
};

type StoredMemoryRound = {
  schemaVersion: 2;
  ownerId: string;
  createdAt: string;
  currentIndex: number;
  questions: MemoryQuestion[];
};

type PendingMemoryResult = {
  id: string;
  ownerId: string;
  recordId: string;
  contentType: CardLearningContentType | null;
  contentVersion: string | null;
  clozeVersion: number;
  blankIds: string[];
  firstAttemptCorrect: boolean;
};

type ScreenPhase = "loading" | "playing" | "empty" | "error" | "summary";

export async function hasStoredMemoryRound(): Promise<boolean> {
  const ownerId = await currentMemoryRoundOwnerId();
  return ownerId ? Boolean(await readStoredRound(ownerId)) : false;
}

export function MemoryRoundScreen({
  onClose,
  onOpenCard,
  onOpenLibrary,
  onResumeStateChange,
  onCardChanged,
  onCurrentCardChange,
  refreshRevision,
}: {
  onClose: () => void;
  onOpenCard: (recordId: string) => void;
  onOpenLibrary: () => void;
  onResumeStateChange: (available: boolean) => void;
  onCardChanged: () => void;
  onCurrentCardChange: (recordId: string | null) => void;
  refreshRevision: number;
}) {
  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [round, setRound] = useState<StoredMemoryRound | null>(null);
  const [summaryTotal, setSummaryTotal] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sentenceIncorrect, setSentenceIncorrect] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [failedImageQuestionIds, setFailedImageQuestionIds] = useState<Set<string>>(new Set());
  const transition = useRef(new Animated.Value(0)).current;
  const success = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const wrongOffset = useRef(new Animated.Value(0)).current;
  const attemptedQuestionIds = useRef(new Set<string>()).current;
  const answerActionLocked = useRef(false);
  const mountedRef = useRef(true);
  const startRunIdRef = useRef(0);
  const refreshRevisionRef = useRef(refreshRevision);

  const start = async (showLoading = true) => {
    const runId = ++startRunIdRef.current;
    const isCurrentRun = () => mountedRef.current && startRunIdRef.current === runId;
    const visibleQuestionId = round?.questions[round.currentIndex]?.id ?? null;
    if (showLoading) setPhase("loading");
    const resolvedOwnerId = await currentMemoryRoundOwnerId();
    if (!isCurrentRun()) return;
    if (!resolvedOwnerId) {
      setPhase("error");
      return;
    }
    setOwnerId(resolvedOwnerId);
    const stored = await readStoredRound(resolvedOwnerId);
    for (const question of stored?.questions.filter((item) => item.completed && item.firstAttemptCorrect !== null && !item.resultSynced) ?? []) {
      await enqueuePendingResult(resolvedOwnerId, pendingResultFromQuestion(resolvedOwnerId, question));
      if (!isCurrentRun()) return;
    }
    try {
      const [candidates, validated, pendingResults] = await Promise.all([
        getCardMemoryRoundCandidates(60),
        stored ? validateCardMemoryRoundCandidates(stored.questions.map((question) => ({
          recordId: question.recordId,
          contentType: question.contentType,
          contentVersion: question.contentVersion,
        }))) : Promise.resolve([]),
        readPendingResults(resolvedOwnerId),
      ]);
      if (!isCurrentRun()) return;
      void flushPendingResults(resolvedOwnerId, pendingResults, () => {
        if (isCurrentRun()) onCardChanged();
      }, (resultId) => {
        if (!isCurrentRun()) return;
        setRound((current) => markQuestionResultSynced(current, resultId));
      });
      const candidatesById = new Map(validated.map((candidate) => [candidate.recordId, candidate]));
      const storedCurrentId = stored?.questions[stored.currentIndex]?.id ?? null;
      const resumed = stored
        ? {
            ...stored,
            questions: stored.questions.flatMap((question) => {
              const candidate = candidatesById.get(question.recordId);
              const currentBlankIds = new Set(candidate?.clozeState.blanks.map((blank) => blank.id) ?? []);
              if (!candidate || !candidate.segments.some((segment) => segment.id === question.segmentId) || !question.blankIds.every((blankId) => currentBlankIds.has(blankId))) return [];
              return [{
                ...question,
                title: candidate.displayTitle,
                languageCode: candidate.languageCode,
                thumbnailUrl: candidate.thumbnail?.url ?? null,
                clozeVersion: question.completed ? question.clozeVersion : candidate.clozeVersion,
              }];
            }),
          }
        : null;
      if (resumed?.questions.length) {
        const storedCurrentIndex = storedCurrentId ? resumed.questions.findIndex((question) => question.id === storedCurrentId) : -1;
        const firstIncomplete = resumed.questions.findIndex((question) => !question.completed);
        const currentIndex = storedCurrentIndex >= 0
          ? storedCurrentIndex
          : firstIncomplete >= 0 ? firstIncomplete : resumed.questions.length - 1;
        const next = { ...resumed, currentIndex };
        if (visibleQuestionId !== next.questions[currentIndex]?.id) transition.setValue(0);
        setRound(next);
        setPhase("playing");
        onResumeStateChange(true);
        await persistRound(resolvedOwnerId, next);
        return;
      }
      const pendingRecordIds = new Set(pendingResults.map((result) => result.recordId));
      const questions = shuffle(buildQuestions(candidates.filter((candidate) => !pendingRecordIds.has(candidate.recordId))).slice(0, MAX_QUESTIONS));
      if (!questions.length) {
        await clearStoredRound(resolvedOwnerId);
        onResumeStateChange(false);
        setPhase("empty");
        return;
      }
      const next: StoredMemoryRound = {
        schemaVersion: 2,
        ownerId: resolvedOwnerId,
        createdAt: new Date().toISOString(),
        currentIndex: 0,
        questions,
      };
      transition.setValue(0);
      setRound(next);
      setPhase("playing");
      onResumeStateChange(true);
      await persistRound(resolvedOwnerId, next);
    } catch {
      if (!isCurrentRun()) return;
      if (stored?.questions.length) {
        setRound({ ...stored, currentIndex: Math.max(0, Math.min(stored.currentIndex, stored.questions.length - 1)) });
        setPhase("playing");
        onResumeStateChange(true);
      } else {
        setPhase("error");
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void start();
    return () => {
      mountedRef.current = false;
      startRunIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (refreshRevisionRef.current === refreshRevision) return;
    refreshRevisionRef.current = refreshRevision;
    void start(false);
  }, [refreshRevision]);

  const question = round?.questions[round.currentIndex] ?? null;
  useEffect(() => {
    onCurrentCardChange(question?.recordId ?? null);
  }, [onCurrentCardChange, question?.recordId]);
  useEffect(() => () => onCurrentCardChange(null), [onCurrentCardChange]);
  useEffect(() => {
    if (!question || question.completed || phase !== "playing") {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    let animation: Animated.CompositeAnimation | null = null;
    const startPulse = () => {
      animation?.stop();
      pulse.stopAnimation();
      pulse.setValue(0);
      animation = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 820, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 820, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      animation.start();
    };
    startPulse();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") startPulse();
      else animation?.stop();
    });
    return () => {
      subscription.remove();
      animation?.stop();
      pulse.stopAnimation();
    };
  }, [phase, pulse, question?.completed, question?.id, refreshRevision]);
  useEffect(() => {
    if (!question) return;
    transition.stopAnimation();
    transition.setValue(0);
    const frame = requestAnimationFrame(() => {
      Animated.timing(transition, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      cancelAnimationFrame(frame);
      transition.stopAnimation();
    };
  }, [question?.id, transition]);
  useEffect(() => {
    setAudioUnavailable(false);
    answerActionLocked.current = false;
    setChecking(false);
    wrongOffset.stopAnimation();
    wrongOffset.setValue(0);
    success.stopAnimation();
    success.setValue(question?.completed ? 1 : 0);
  }, [question?.id, success, wrongOffset]);
  const selectedTokens = useMemo(() => question?.selectedTokenIds
    .map((id) => question.tokens.find((token) => token.id === id))
    .filter((token): token is MemoryQuestion["tokens"][number] => Boolean(token)) ?? [], [question]);
  const availableTokens = useMemo(() => question?.tokens.filter((token) => !question.selectedTokenIds.includes(token.id)) ?? [], [question]);

  const updateQuestion = (update: (current: MemoryQuestion) => MemoryQuestion): void => {
    if (!question) return;
    setRound((current) => {
      if (!current) return current;
      const questions = current.questions.map((item) => item.id === question.id ? update(item) : item);
      const next = { ...current, questions };
      if (ownerId) void persistRound(ownerId, next);
      return next;
    });
  };

  const playWrongFeedback = (): void => {
    wrongOffset.stopAnimation();
    wrongOffset.setValue(0);
    Animated.sequence([
      Animated.timing(wrongOffset, { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(wrongOffset, { toValue: -1, duration: 75, useNativeDriver: true }),
      Animated.timing(wrongOffset, { toValue: 0.55, duration: 65, useNativeDriver: true }),
      Animated.timing(wrongOffset, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const recordFirstAttempt = (correct: boolean): void => {
    if (!question || question.firstAttemptCorrect !== null || attemptedQuestionIds.has(question.id)) return;
    attemptedQuestionIds.add(question.id);
    const updated = { ...question, firstAttemptCorrect: correct, resultSynced: false };
    updateQuestion(() => updated);
  };

  const completeQuestion = (firstAttemptCorrect: boolean) => {
    if (!question || !ownerId) return;
    setSentenceIncorrect(false);
    const completed = { ...question, firstAttemptCorrect, completed: true, resultSynced: false };
    updateQuestion(() => completed);
    const pending = pendingResultFromQuestion(ownerId, completed);
    void enqueuePendingResult(ownerId, pending)
      .then(() => syncPendingResult(ownerId, pending))
      .then((synced) => {
        if (!synced || !mountedRef.current) return;
        updateQuestion((current) => ({ ...current, resultSynced: true }));
        onCardChanged();
      })
      .catch(() => undefined);
    success.setValue(0);
    Animated.spring(success, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
  };

  const chooseOption = async (option: string) => {
    if (!question || question.completed || answerActionLocked.current || question.disabledOptions.includes(option)) return;
    answerActionLocked.current = true;
    setChecking(true);
    const correct = normalizeAnswer(option) === normalizeAnswer(question.answer);
    recordFirstAttempt(correct);
    if (correct) completeQuestion(question.firstAttemptCorrect ?? true);
    else {
      updateQuestion((current) => ({ ...current, disabledOptions: [...current.disabledOptions, option] }));
      playWrongFeedback();
    }
    setTimeout(() => {
      if (!mountedRef.current) return;
      answerActionLocked.current = false;
      setChecking(false);
    }, 220);
  };

  const checkSentence = async () => {
    if (!question || question.completed || answerActionLocked.current || selectedTokens.length !== question.tokens.length) return;
    answerActionLocked.current = true;
    setChecking(true);
    const correct = selectedTokens.map((token) => token.text).join("") === question.sentence;
    recordFirstAttempt(correct);
    if (correct) completeQuestion(question.firstAttemptCorrect ?? true);
    else {
      setSentenceIncorrect(true);
      playWrongFeedback();
    }
    setTimeout(() => {
      if (!mountedRef.current) return;
      answerActionLocked.current = false;
      setChecking(false);
    }, 220);
  };

  const continueRound = async () => {
    if (!round || !question?.completed) return;
    const nextIndex = round.currentIndex + 1;
    if (nextIndex >= round.questions.length) {
      setSummaryTotal(round.questions.length);
      setPhase("summary");
      setRound(null);
      if (ownerId) await clearStoredRound(ownerId);
      onResumeStateChange(false);
      return;
    }
    transition.setValue(0);
    const next = { ...round, currentIndex: nextIndex };
    setRound(next);
    setSentenceIncorrect(false);
    if (ownerId) await persistRound(ownerId, next);
  };

  const playSentence = async () => {
    if (!question || audioLoading) return;
    setAudioLoading(true);
    setAudioUnavailable(false);
    try {
      const audio = await getCardSegmentAudio({
        entryId: question.recordId.replace(/^card:/, ""),
        segmentId: question.segmentId,
        sourceKind: "review_segment",
        contentType: question.contentType ?? undefined,
        contentVersion: question.contentVersion ?? undefined,
      });
      await playTtsAudio({ url: audio.audioUrl });
    } catch { if (mountedRef.current) setAudioUnavailable(true); }
    finally { if (mountedRef.current) setAudioLoading(false); }
  };

  if (phase === "loading") return <SafeAreaView style={styles.page}><Header onClose={onClose} /><View style={styles.center}><ActivityIndicator color="#5E7C6A" /><Text style={styles.loadingText}>{t("memory_round.loading")}</Text></View></SafeAreaView>;
  if (phase === "error") return <SafeAreaView style={styles.page}><Header onClose={onClose} /><View style={styles.center}><Text style={styles.emptyTitle}>{t("memory_round.load_failed")}</Text><Pressable style={styles.lightButton} onPress={() => void start()}><Text style={styles.lightButtonText}>{t("common.retry")}</Text></Pressable></View></SafeAreaView>;
  if (phase === "empty") return <SafeAreaView style={styles.page}><Header onClose={onClose} /><View style={styles.center}><View style={styles.emptyGlyph}><Ionicons name="sparkles-outline" size={28} color="#7A6E9D" /></View><Text style={styles.emptyTitle}>{t("memory_round.empty_title")}</Text><Text style={styles.emptyText}>{t("memory_round.empty_text")}</Text><Pressable style={styles.lightButton} onPress={onOpenLibrary}><Text style={styles.lightButtonText}>{t("memory_round.go_cards")}</Text><Ionicons name="arrow-forward" size={17} color="#4F6557" /></Pressable></View></SafeAreaView>;
  if (phase === "summary") return <SafeAreaView style={styles.summaryPage}><Header onClose={onClose} /><View style={styles.summaryBody}><View style={styles.finishRoute}>{Array.from({ length: Math.max(1, summaryTotal) }, (_, index) => { const color = ["#8FD5C2", "#8CC8F0", "#F5BC91", "#B5A1E6"][index % 4]!; return <React.Fragment key={index}>{index ? <View style={[styles.finishConnector, { backgroundColor: color }]} /> : null}<View style={[styles.finishNode, { backgroundColor: color }]} /></React.Fragment>; })}</View><Text style={styles.summaryTitle}>{t("memory_round.finished")}</Text><Pressable style={styles.primaryButton} onPress={onClose}><Text style={styles.primaryButtonText}>{t("memory_round.done")}</Text></Pressable><Pressable style={styles.againButton} onPress={() => void start()}><Text style={styles.againButtonText}>{t("memory_round.again")}</Text></Pressable></View></SafeAreaView>;
  if (!round || !question) return null;

  const currentColor = ["#8FD5C2", "#8CC8F0", "#F5BC91", "#B5A1E6"][round.currentIndex % 4]!;
  const sentenceTypography = memorySentenceTypography(question.sentence);
  return <SafeAreaView style={[styles.page, { backgroundColor: `${currentColor}20` }]}>
    <Header onClose={onClose} onOpenCard={() => onOpenCard(question.recordId)} />
    <Progress total={round.questions.length} current={round.currentIndex} currentCompleted={question.completed} pulse={pulse} completion={success} colors={["#8FD5C2", "#8CC8F0", "#F5BC91", "#B5A1E6"]} />
    <Animated.View style={[styles.questionPage, { opacity: transition, transform: [{ translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      <ScrollView contentContainerStyle={styles.questionScroll} showsVerticalScrollIndicator={false}>
        {question.thumbnailUrl && !failedImageQuestionIds.has(question.id) ? <Image source={{ uri: question.thumbnailUrl }} resizeMode="cover" style={styles.memoryImage} onError={() => setFailedImageQuestionIds((current) => new Set(current).add(question.id))} /> : <View style={styles.titlePrompt}><View style={[styles.titleDot, { backgroundColor: currentColor }]} /><Text style={styles.titlePromptText}>{question.title}</Text></View>}
        <View style={styles.questionHeading}><View style={styles.audioArea}><Pressable accessibilityLabel={t("memory_round.play_audio")} style={styles.audioButton} onPress={() => void playSentence()}>{audioLoading ? <ActivityIndicator size="small" color="#59636E" /> : <Ionicons name="volume-medium-outline" size={21} color="#59636E" />}</Pressable>{audioUnavailable ? <Text style={styles.audioError}>{t("memory_round.audio_unavailable")}</Text> : null}</View></View>
        <Animated.View style={{ transform: [{ translateX: wrongOffset.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] }}>
        {question.kind === "choice" ? <>
          <View style={styles.sentenceSurface}><Text accessibilityLabel={question.completed ? question.sentence : `${question.before} … ${question.after}`} style={[styles.sentence, sentenceTypography]}>{question.before}<Text style={[styles.blank, !question.completed && styles.blankHidden]}>{question.answer}</Text>{question.after}</Text></View>
          <View style={styles.options}>{question.options.map((option) => {
            const disabled = question.disabledOptions.includes(option);
            const isAnswer = question.completed && normalizeAnswer(option) === normalizeAnswer(question.answer);
            return <Pressable key={option} disabled={disabled || question.completed || checking} style={({ pressed }) => [styles.option, pressed && styles.optionPressed, disabled && styles.optionWrong, isAnswer && styles.optionCorrect]} onPress={() => void chooseOption(option)}><Text style={[styles.optionText, memoryOptionTypography(option), disabled && styles.optionWrongText, isAnswer && styles.optionCorrectText]}>{option}</Text>{disabled ? <Ionicons name="close" size={20} color="#D56E6E" /> : isAnswer ? <Ionicons name="checkmark" size={20} color="#43816E" /> : null}</Pressable>;
          })}</View>
        </> : question.completed ? <View style={styles.completedSentenceCard}><Text style={[styles.completedSentence, sentenceTypography]}>{question.sentence}</Text></View> : <>
          <View style={[styles.sentenceTray, sentenceIncorrect && styles.sentenceTrayWrong]}>{selectedTokens.length ? <View style={styles.tokenWrap}>{selectedTokens.map((token) => <Pressable key={token.id} style={styles.selectedToken} onPress={() => { setSentenceIncorrect(false); updateQuestion((current) => ({ ...current, selectedTokenIds: current.selectedTokenIds.filter((id) => id !== token.id) })); }}><Text style={styles.selectedTokenText}>{token.text.trim()}</Text></Pressable>)}</View> : <Text style={styles.trayHint}>{t("memory_round.tap_words")}</Text>}</View>
          <View style={styles.tokenWrap}>{availableTokens.map((token) => <Pressable key={token.id} style={styles.token} onPress={() => { setSentenceIncorrect(false); updateQuestion((current) => ({ ...current, selectedTokenIds: [...current.selectedTokenIds, token.id] })); }}><Text style={styles.tokenText}>{token.text.trim()}</Text></Pressable>)}</View>
          <Pressable disabled={selectedTokens.length !== question.tokens.length || checking} style={[styles.checkButton, selectedTokens.length !== question.tokens.length && styles.buttonDisabled, sentenceIncorrect && styles.checkButtonWrong]} onPress={() => void checkSentence()}><Text style={styles.checkButtonText}>{sentenceIncorrect ? t("memory_round.try_again") : t("memory_round.check")}</Text></Pressable>
        </>}
        </Animated.View>
        {question.completed ? <Animated.View style={[styles.completionActions, { opacity: success, transform: [{ translateY: success.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}><Pressable style={styles.continueButton} onPress={() => void continueRound()}><Text style={styles.primaryButtonText}>{t("common.continue")}</Text><Ionicons name="arrow-forward" size={18} color="#FFFFFF" /></Pressable></Animated.View> : null}
      </ScrollView>
    </Animated.View>
  </SafeAreaView>;
}

function Header({ onClose, onOpenCard }: { onClose: () => void; onOpenCard?: () => void }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" style={styles.headerButton} onPress={onClose}><Ionicons name="close" size={24} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{t("memory_round.title")}</Text>{onOpenCard ? <Pressable accessibilityRole="button" accessibilityLabel={t("memory_round.view_card")} style={styles.headerCardButton} onPress={onOpenCard}><Text style={styles.headerCardButtonText}>{t("memory_round.original_card")}</Text></Pressable> : <View style={styles.headerButton} />}</View>;
}

function Progress({ total, current, currentCompleted, pulse, completion, colors }: { total: number; current: number; currentCompleted: boolean; pulse: Animated.Value; completion: Animated.Value; colors: string[] }) {
  return <View style={styles.progress}>{Array.from({ length: total }, (_, index) => <React.Fragment key={index}>{index > 0 ? <View style={[styles.connector, index <= current && { backgroundColor: colors[(index - 1) % colors.length] }]} /> : null}<Animated.View style={[styles.progressNode, index <= current && { backgroundColor: colors[index % colors.length] }, index === current && !currentCompleted && { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.68, 1] }) }, index === current && currentCompleted && { transform: [{ scale: completion.interpolate({ inputRange: [0, 0.58, 1], outputRange: [0.82, 1.28, 1], extrapolate: "clamp" }) }] }]}>{index < current || index === current && currentCompleted ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}</Animated.View></React.Fragment>)}</View>;
}

function memorySentenceTypography(text: string): { fontSize: number; lineHeight: number } {
  const length = Array.from(text.trim()).length;
  if (length >= 105) return { fontSize: 17, lineHeight: 27 };
  if (length >= 72) return { fontSize: 18.5, lineHeight: 29 };
  if (length >= 46) return { fontSize: 20, lineHeight: 31 };
  return { fontSize: 22, lineHeight: 34 };
}

function memoryOptionTypography(text: string): { fontSize: number; lineHeight: number } {
  const length = Array.from(text.trim()).length;
  if (length >= 34) return { fontSize: 15, lineHeight: 21 };
  if (length >= 20) return { fontSize: 16, lineHeight: 23 };
  return { fontSize: 17, lineHeight: 24 };
}

function buildQuestions(candidates: CardMemoryRoundCandidate[]): MemoryQuestion[] {
  const blanks = candidates.flatMap((candidate) => candidate.clozeState.blanks.map((blank) => ({ candidate, blank })));
  const questions = candidates.flatMap((candidate) => {
    const bySegment = new Map<string, CardClozeBlank[]>();
    for (const blank of candidate.clozeState.blanks) {
      const current = bySegment.get(blank.segmentId) ?? [];
      current.push(blank);
      bySegment.set(blank.segmentId, current);
    }
    const groups = [...bySegment.entries()].map(([segmentId, segmentBlanks]) => ({
      segment: candidate.segments.find((segment) => segment.id === segmentId),
      hasUnmastered: segmentBlanks.some((blank) => !blank.mastered),
      blanks: segmentBlanks.filter((blank) => !blank.mastered).length ? segmentBlanks.filter((blank) => !blank.mastered) : segmentBlanks,
    })).filter((group): group is { segment: CardMemoryRoundCandidate["segments"][number]; blanks: CardClozeBlank[]; hasUnmastered: boolean } => Boolean(group.segment && group.blanks.length));
    const preferredGroups = groups.some((group) => group.hasUnmastered) ? groups.filter((group) => group.hasUnmastered) : groups;
    const dense = shuffle(preferredGroups.filter((group) =>
      canBuildMemorySentencePuzzle(group.segment.text) && isDenseMemoryCloze(group.segment.text, group.blanks),
    ))[0];
    if (dense) return [baseQuestion(candidate, dense.segment.id, dense.segment.text, {
      kind: "sentence",
      answer: dense.segment.text,
      blankIds: dense.blanks.map((blank) => blank.id),
      tokens: shuffle(memorySentenceTokens(dense.segment.text)),
    })];
    const regular = shuffle(preferredGroups.flatMap((group) => group.blanks.map((blank) => ({ segment: group.segment, blank })) ))[0];
    if (!regular) return [];
    const normalizedSentence = normalizeAnswer(regular.segment.text);
    const distractors = shuffle(blanks
      .filter((item) => item.candidate.recordId !== candidate.recordId && sameMemoryLanguageFamily(item.candidate.languageCode, candidate.languageCode))
      .map((item) => item.blank.answer)
      .filter((answer, index, all) => isCompatibleDistractor(regular.blank.answer, answer) && !normalizedSentence.includes(normalizeAnswer(answer)) && all.findIndex((item) => normalizeAnswer(item) === normalizeAnswer(answer)) === index))
      .slice(0, 2);
    if (!distractors.length) return [];
    const start = Math.max(0, Math.min(regular.segment.text.length, regular.blank.startUtf16));
    const end = Math.max(start, Math.min(regular.segment.text.length, regular.blank.endUtf16));
    return [baseQuestion(candidate, regular.segment.id, regular.segment.text, {
      kind: "choice",
      blankIds: [regular.blank.id],
      before: regular.segment.text.slice(0, start),
      answer: regular.segment.text.slice(start, end) || regular.blank.answer,
      after: regular.segment.text.slice(end),
      options: shuffle([regular.segment.text.slice(start, end) || regular.blank.answer, ...distractors]),
    })];
  });
  return questions;
}

function baseQuestion(candidate: CardMemoryRoundCandidate, segmentId: string, sentence: string, value: Partial<MemoryQuestion>): MemoryQuestion {
  return {
    id: `${candidate.recordId}:${segmentId}:${candidate.clozeVersion}`,
    recordId: candidate.recordId,
    title: candidate.displayTitle,
    languageCode: candidate.languageCode,
    thumbnailUrl: candidate.thumbnail?.url ?? null,
    contentType: candidate.contentType,
    contentVersion: candidate.contentVersion,
    clozeVersion: candidate.clozeVersion,
    segmentId,
    blankIds: [],
    sentence,
    kind: "choice",
    before: "",
    answer: "",
    after: "",
    options: [],
    tokens: [],
    selectedTokenIds: [],
    disabledOptions: [],
    firstAttemptCorrect: null,
    resultSynced: false,
    completed: false,
    ...value,
  };
}

function isCompatibleDistractor(answer: string, candidate: string): boolean {
  const left = normalizeAnswer(answer);
  const right = normalizeAnswer(candidate);
  if (!left || !right || left === right) return false;
  const leftPhrase = /\s/u.test(left.trim());
  const rightPhrase = /\s/u.test(right.trim());
  if (leftPhrase !== rightPhrase) return false;
  const ratio = right.length / Math.max(1, left.length);
  return ratio >= 0.45 && ratio <= 2.2;
}

function normalizeAnswer(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function pendingResultFromQuestion(ownerId: string, question: MemoryQuestion): PendingMemoryResult {
  return {
    id: question.id,
    ownerId,
    recordId: question.recordId,
    contentType: question.contentType,
    contentVersion: question.contentVersion,
    clozeVersion: question.clozeVersion,
    blankIds: question.blankIds,
    firstAttemptCorrect: question.firstAttemptCorrect === true,
  };
}

async function savePendingResult(result: PendingMemoryResult, baseVersion = result.clozeVersion): Promise<void> {
  await saveCardClozeUpdate(result.recordId, {
    baseVersion,
    operation: { type: "memory_result", blankIds: result.blankIds },
    result: result.firstAttemptCorrect ? "correct" : "incorrect",
    ...(result.contentType && result.contentVersion ? { contentType: result.contentType, contentVersion: result.contentVersion } : {}),
  });
}

const pendingSyncs = new Map<string, Promise<boolean>>();

async function syncPendingResult(ownerId: string, result: PendingMemoryResult): Promise<boolean> {
  const syncKey = `${ownerId}:${result.id}`;
  const existing = pendingSyncs.get(syncKey);
  if (existing) return existing;
  const sync = (async () => {
    if (await currentMemoryRoundOwnerId() !== ownerId) return false;
    try {
      await savePendingResult(result);
      await removePendingResult(ownerId, result.id);
      return true;
    } catch (error) {
      if (await currentMemoryRoundOwnerId() !== ownerId) return false;
      if (!(error instanceof CardApiError) || error.code !== "CARD_PRACTICE_CONFLICT") {
        if (error instanceof CardApiError && error.code === "CARD_NOT_FOUND") {
          await removePendingResult(ownerId, result.id);
          return true;
        }
        return false;
      }
      try {
        if (await currentMemoryRoundOwnerId() !== ownerId) return false;
        const [candidate] = await validateCardMemoryRoundCandidates([{
          recordId: result.recordId,
          contentType: result.contentType,
          contentVersion: result.contentVersion,
        }]);
        if (!candidate) {
          await removePendingResult(ownerId, result.id);
          return true;
        }
        const blanks = new Map(candidate.clozeState.blanks.map((blank) => [blank.id, blank]));
        const targetBlanks = result.blankIds.map((blankId) => blanks.get(blankId));
        if (targetBlanks.some((blank) => !blank)) {
          await removePendingResult(ownerId, result.id);
          return true;
        }
        const expectedResult = result.firstAttemptCorrect ? "correct" : "incorrect";
        if (targetBlanks.every((blank) => blank?.mastered) && candidate.clozeLastResult === expectedResult) {
          await removePendingResult(ownerId, result.id);
          return true;
        }
        await savePendingResult(result, candidate.clozeVersion);
        await removePendingResult(ownerId, result.id);
        return true;
      } catch {
        return false;
      }
    }
  })().finally(() => pendingSyncs.delete(syncKey));
  pendingSyncs.set(syncKey, sync);
  return sync;
}

async function flushPendingResults(
  ownerId: string,
  results: PendingMemoryResult[],
  onCardChanged: () => void,
  onSynced: (resultId: string) => void,
): Promise<void> {
  for (const result of results) {
    if (await currentMemoryRoundOwnerId() !== ownerId) return;
    if (await syncPendingResult(ownerId, result)) {
      onSynced(result.id);
      onCardChanged();
    }
  }
}

function markQuestionResultSynced(round: StoredMemoryRound | null, resultId: string): StoredMemoryRound | null {
  if (!round) return round;
  const next = { ...round, questions: round.questions.map((question) => question.id === resultId ? { ...question, resultSynced: true } : question) };
  void persistRound(round.ownerId, next);
  return next;
}

async function readStoredRound(ownerId: string): Promise<StoredMemoryRound | null> {
  try {
    await memoryRoundStorageQueue.catch(() => undefined);
    const raw = await AsyncStorage.getItem(memoryRoundStorageKey(ownerId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredMemoryRound>;
    if (value.schemaVersion !== 2 || value.ownerId !== ownerId || !Array.isArray(value.questions) || !value.questions.length || !Number.isInteger(value.currentIndex) || value.currentIndex! < 0 || value.currentIndex! >= value.questions.length) return null;
    if (value.questions.some((question) => !isStoredMemoryQuestion(question))) return null;
    return value as StoredMemoryRound;
  } catch {
    return null;
  }
}

async function persistRound(ownerId: string, round: StoredMemoryRound): Promise<void> {
  const key = memoryRoundStorageKey(ownerId);
  const write = async () => AsyncStorage.setItem(key, JSON.stringify(round));
  memoryRoundStorageQueue = memoryRoundStorageQueue.then(write, write);
  await memoryRoundStorageQueue;
}

async function clearStoredRound(ownerId: string): Promise<void> {
  const key = memoryRoundStorageKey(ownerId);
  const clear = async () => AsyncStorage.removeItem(key);
  memoryRoundStorageQueue = memoryRoundStorageQueue.then(clear, clear);
  await memoryRoundStorageQueue;
}

function memoryRoundStorageKey(ownerId: string): string {
  return `${MEMORY_ROUND_STORAGE_KEY}.${ownerId}`;
}

function pendingResultsStorageKey(ownerId: string): string {
  return `${MEMORY_ROUND_PENDING_KEY}.${ownerId}`;
}

async function currentMemoryRoundOwnerId(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ?? null;
}

async function readPendingResults(ownerId: string): Promise<PendingMemoryResult[]> {
  await memoryRoundStorageQueue.catch(() => undefined);
  try {
    const value = JSON.parse((await AsyncStorage.getItem(pendingResultsStorageKey(ownerId))) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is PendingMemoryResult => isPendingMemoryResult(item, ownerId)) : [];
  } catch {
    return [];
  }
}

async function enqueuePendingResult(ownerId: string, result: PendingMemoryResult): Promise<void> {
  const key = pendingResultsStorageKey(ownerId);
  const write = async () => {
    const current = await readPendingResultsDirect(key, ownerId);
    const next = [...current.filter((item) => item.id !== result.id), result];
    await AsyncStorage.setItem(key, JSON.stringify(next));
  };
  memoryRoundStorageQueue = memoryRoundStorageQueue.then(write, write);
  await memoryRoundStorageQueue;
}

async function removePendingResult(ownerId: string, resultId: string): Promise<void> {
  const key = pendingResultsStorageKey(ownerId);
  const write = async () => {
    const current = await readPendingResultsDirect(key, ownerId);
    const next = current.filter((item) => item.id !== resultId);
    if (next.length) await AsyncStorage.setItem(key, JSON.stringify(next));
    else await AsyncStorage.removeItem(key);
  };
  memoryRoundStorageQueue = memoryRoundStorageQueue.then(write, write);
  await memoryRoundStorageQueue;
}

async function readPendingResultsDirect(key: string, ownerId: string): Promise<PendingMemoryResult[]> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(key)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is PendingMemoryResult => isPendingMemoryResult(item, ownerId)) : [];
  } catch {
    return [];
  }
}

function isStoredMemoryQuestion(value: unknown): value is MemoryQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<MemoryQuestion>;
  return typeof question.id === "string" && typeof question.recordId === "string" && typeof question.segmentId === "string"
    && typeof question.sentence === "string" && typeof question.answer === "string"
    && (question.kind === "choice" || question.kind === "sentence")
    && Array.isArray(question.blankIds) && question.blankIds.every((id) => typeof id === "string")
    && Array.isArray(question.options) && Array.isArray(question.tokens) && Array.isArray(question.selectedTokenIds)
    && Array.isArray(question.disabledOptions) && (question.firstAttemptCorrect === null || typeof question.firstAttemptCorrect === "boolean")
    && typeof question.resultSynced === "boolean" && typeof question.completed === "boolean";
}

function isPendingMemoryResult(value: unknown, ownerId: string): value is PendingMemoryResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<PendingMemoryResult>;
  return result.ownerId === ownerId && typeof result.id === "string" && typeof result.recordId === "string"
    && Number.isInteger(result.clozeVersion) && Array.isArray(result.blankIds) && result.blankIds.length > 0
    && result.blankIds.every((id) => typeof id === "string") && typeof result.firstAttemptCorrect === "boolean";
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F8FAF9" },
  summaryPage: { flex: 1, backgroundColor: "#F4F1FB" },
  header: { height: 54, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 56, height: 40, alignItems: "flex-start", justifyContent: "center" },
  headerCardButton: { width: 56, height: 40, alignItems: "flex-end", justifyContent: "center" },
  headerCardButtonText: { color: "#52645D", fontSize: 14, fontWeight: "600" },
  headerTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  center: { flex: 1, paddingHorizontal: 42, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, color: theme.colors.textMuted, fontSize: 14 },
  emptyGlyph: { width: 64, height: 64, borderRadius: 22, backgroundColor: "#EDE7FA", alignItems: "center", justifyContent: "center", marginBottom: 22 },
  emptyTitle: { color: theme.colors.text, fontSize: 22, lineHeight: 30, fontWeight: "600", textAlign: "center" },
  emptyText: { marginTop: 12, color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23, textAlign: "center" },
  lightButton: { marginTop: 24, minHeight: 48, paddingHorizontal: 20, borderRadius: 16, backgroundColor: "#E4F1E8", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  lightButtonText: { color: "#4F6557", fontSize: 15, fontWeight: "600" },
  progress: { height: 42, paddingHorizontal: 28, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  connector: { flex: 1, maxWidth: 34, height: 3, borderRadius: 2, backgroundColor: "#DCE2E0" },
  progressNode: { width: 15, height: 15, borderRadius: 8, backgroundColor: "#DCE2E0", alignItems: "center", justifyContent: "center" },
  questionPage: { flex: 1 },
  questionScroll: { paddingHorizontal: 20, paddingBottom: 48 },
  memoryImage: { width: "100%", height: 164, marginTop: 8, borderRadius: 22, backgroundColor: "#E8ECEB" },
  titlePrompt: { minHeight: 72, marginTop: 8, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.72)", flexDirection: "row", alignItems: "center", gap: 12 },
  titleDot: { width: 10, height: 10, borderRadius: 5 },
  titlePromptText: { flex: 1, color: theme.colors.text, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  questionHeading: { marginTop: 12, marginBottom: 7, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  audioButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.76)", alignItems: "center", justifyContent: "center" },
  audioArea: { alignItems: "flex-end" },
  audioError: { position: "absolute", top: 40, right: 0, width: 120, color: theme.colors.textMuted, fontSize: 11, textAlign: "right" },
  sentenceSurface: { paddingHorizontal: 18, paddingVertical: 17, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(78,98,89,0.13)", backgroundColor: "rgba(255,255,255,0.76)" },
  sentence: { color: theme.colors.text, fontSize: 20, lineHeight: 31, fontWeight: "400" },
  blank: { color: "#397461", textDecorationLine: "underline", textDecorationColor: "#72A18F" },
  blankHidden: { color: "transparent" },
  options: { marginTop: 14, gap: 10 },
  option: { minHeight: 54, paddingHorizontal: 17, paddingVertical: 10, borderRadius: 17, borderWidth: 1.25, borderColor: "rgba(93,113,104,0.17)", backgroundColor: "rgba(255,255,255,0.88)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  optionText: { flex: 1, paddingRight: 10, color: theme.colors.text, fontSize: 17, lineHeight: 24, fontWeight: "400" },
  optionWrong: { borderColor: "#E59A91", backgroundColor: "#FBE8E5" },
  optionWrongText: { color: "#B75F5F", textDecorationLine: "line-through" },
  optionCorrect: { borderColor: "#7BC4AC", backgroundColor: "#DDF3EA" },
  optionCorrectText: { color: "#397461" },
  sentenceTray: { minHeight: 130, padding: 14, borderRadius: 20, borderWidth: 1.5, borderColor: "#D6E2DD", backgroundColor: "rgba(255,255,255,0.78)", justifyContent: "center" },
  sentenceTrayWrong: { borderColor: "#DF8A82", backgroundColor: "#FBEAE7" },
  trayHint: { color: theme.colors.textMuted, fontSize: 15, textAlign: "center" },
  tokenWrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  token: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "#D7DBE3", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  tokenText: { color: theme.colors.text, fontSize: 16, fontWeight: "400" },
  selectedToken: { minHeight: 38, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "#DCEDE8", alignItems: "center", justifyContent: "center" },
  selectedTokenText: { color: "#365E52", fontSize: 16, fontWeight: "400" },
  checkButton: { minHeight: 52, marginTop: 22, borderRadius: 17, backgroundColor: "#687E75", alignItems: "center", justifyContent: "center" },
  checkButtonWrong: { backgroundColor: "#C77870" },
  checkButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  buttonDisabled: { opacity: 0.35 },
  completedSentenceCard: { marginTop: 8, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: "#CFE5DC", backgroundColor: "rgba(255,255,255,0.84)" },
  completedSentence: { color: "#397461", fontSize: 20, lineHeight: 31, fontWeight: "400" },
  completionActions: { marginTop: 24 },
  continueButton: { minHeight: 54, paddingHorizontal: 22, borderRadius: 18, backgroundColor: "#566C63", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  primaryButton: { minHeight: 54, marginTop: 20, paddingHorizontal: 28, borderRadius: 18, backgroundColor: "#566C63", alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  againButton: { minHeight: 48, marginTop: 10, alignItems: "center", justifyContent: "center" },
  againButtonText: { color: "#665C80", fontSize: 15, fontWeight: "500" },
  summaryBody: { flex: 1, paddingHorizontal: 36, alignItems: "stretch", justifyContent: "center" },
  finishRoute: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginBottom: 42 },
  finishConnector: { flex: 1, maxWidth: 20, height: 4, borderRadius: 2 },
  finishNode: { width: 22, height: 22, borderRadius: 11, shadowColor: "#6E6584", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 5 } },
  summaryTitle: { color: theme.colors.text, fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: 22 },
});
