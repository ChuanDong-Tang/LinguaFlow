import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import OioCharacter from "../../assets/app/oio-character.svg";
import { t } from "../i18n";
import {
  CardApiError,
  getCardMemoryRoundCandidates,
  getCardMemorySentenceMeaning,
  getCardSegmentAudio,
  saveCardClozeUpdate,
  validateCardMemoryRoundCandidates,
  type CardClozeBlank,
  type CardLearningContentType,
  type CardMemoryRoundCandidate,
} from "../services/api/cardApi";
import { playTtsAudio, stopTtsAudio } from "../services/tts/ttsPlayback";
import { getSession } from "../services/auth/authStorage";
import { theme } from "../theme";
import { canBuildMemorySentencePuzzle, isDenseMemoryCloze, memorySentenceTokens, sameMemoryLanguageFamily } from "./memoryRoundRules";
import { useMemoryPronunciation } from "../hooks/useMemoryPronunciation";

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
  kind: "choice" | "sentence" | "input" | "speech";
  speechFallbackKind?: "choice" | "sentence" | "input";
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
  const { height: viewportHeight } = useWindowDimensions();
  const compactLayout = viewportHeight < 720;
  const [phase, setPhase] = useState<ScreenPhase>("loading");
  const [round, setRound] = useState<StoredMemoryRound | null>(null);
  const [summaryTotal, setSummaryTotal] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sentenceIncorrect, setSentenceIncorrect] = useState(false);
  const [inputAnswer, setInputAnswer] = useState("");
  const [feedbackState, setFeedbackState] = useState<"idle" | "wrong" | "correct">("idle");
  const [meaningExpanded, setMeaningExpanded] = useState(false);
  const [meaningStatus, setMeaningStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [nativeMeaning, setNativeMeaning] = useState<string | null>(null);
  const [meaningUnavailable, setMeaningUnavailable] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
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
  const inputAnswerRef = useRef<TextInput | null>(null);
  const meaningDots = useRef([new Animated.Value(0.28), new Animated.Value(0.28), new Animated.Value(0.28)]).current;
  const meaningRequestRef = useRef(0);
  const sentenceAudioRequestRef = useRef(0);

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
      const questions = assignSpeechQuestions(shuffle(buildQuestions(candidates.filter((candidate) => !pendingRecordIds.has(candidate.recordId))).slice(0, MAX_QUESTIONS)));
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
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mountedRef.current) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => subscription.remove();
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
    if (!question || question.completed || phase !== "playing" || reduceMotion) {
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
  }, [phase, pulse, question?.completed, question?.id, reduceMotion, refreshRevision]);
  useEffect(() => {
    if (!question) return;
    transition.stopAnimation();
    transition.setValue(0);
    const frame = requestAnimationFrame(() => {
      Animated.timing(transition, {
        toValue: 1,
        duration: reduceMotion ? 120 : 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      cancelAnimationFrame(frame);
      transition.stopAnimation();
    };
  }, [question?.id, reduceMotion, transition]);
  useEffect(() => {
    setAudioUnavailable(false);
    setInputAnswer("");
    setMeaningExpanded(false);
    setMeaningStatus("idle");
    setNativeMeaning(null);
    setMeaningUnavailable(false);
    meaningRequestRef.current += 1;
    sentenceAudioRequestRef.current += 1;
    stopTtsAudio({ resetControls: true });
    answerActionLocked.current = false;
    setChecking(false);
    setFeedbackState(question?.completed ? "correct" : "idle");
    wrongOffset.stopAnimation();
    wrongOffset.setValue(0);
    success.stopAnimation();
    success.setValue(question?.completed ? 1 : 0);
  }, [question?.id, success, wrongOffset]);
  useEffect(() => {
    if (meaningStatus !== "loading" || reduceMotion) {
      meaningDots.forEach((dot) => { dot.stopAnimation(); dot.setValue(meaningStatus === "loading" ? 0.72 : 0.28); });
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.stagger(120, meaningDots.map((dot) => Animated.timing(dot, { toValue: 1, duration: 260, useNativeDriver: true }))),
      Animated.stagger(120, meaningDots.map((dot) => Animated.timing(dot, { toValue: 0.28, duration: 260, useNativeDriver: true }))),
    ]));
    animation.start();
    return () => animation.stop();
  }, [meaningDots, meaningStatus, reduceMotion]);
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

  const changeSentenceToken = (tokenId: string, selected: boolean): void => {
    void Haptics.selectionAsync().catch(() => undefined);
    setSentenceIncorrect(false);
    setFeedbackState("idle");
    updateQuestion((current) => ({
      ...current,
      selectedTokenIds: selected
        ? [...current.selectedTokenIds, tokenId]
        : current.selectedTokenIds.filter((id) => id !== tokenId),
    }));
  };

  const playWrongFeedback = (): void => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    setFeedbackState("wrong");
    wrongOffset.stopAnimation();
    wrongOffset.setValue(0);
    if (reduceMotion) return;
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
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setFeedbackState("correct");
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
    if (reduceMotion) success.setValue(1);
    else Animated.spring(success, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
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

  const checkInputAnswer = (): void => {
    if (!question || question.kind !== "input" || question.completed || answerActionLocked.current || !inputAnswer.trim()) return;
    answerActionLocked.current = true;
    setChecking(true);
    const correct = normalizeAnswer(inputAnswer) === normalizeAnswer(question.answer);
    recordFirstAttempt(correct);
    if (correct) completeQuestion(question.firstAttemptCorrect ?? true);
    else {
      setSentenceIncorrect(true);
      playWrongFeedback();
      requestAnimationFrame(() => inputAnswerRef.current?.focus());
    }
    setTimeout(() => {
      if (!mountedRef.current) return;
      answerActionLocked.current = false;
      setChecking(false);
    }, 220);
  };

  const continueRound = async () => {
    if (!round || !question?.completed) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
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
    const requestId = sentenceAudioRequestRef.current + 1;
    sentenceAudioRequestRef.current = requestId;
    void Haptics.selectionAsync().catch(() => undefined);
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
      if (!mountedRef.current || sentenceAudioRequestRef.current !== requestId) return;
      await playTtsAudio({ url: audio.audioUrl });
    } catch { if (mountedRef.current && sentenceAudioRequestRef.current === requestId) setAudioUnavailable(true); }
    finally { if (mountedRef.current && sentenceAudioRequestRef.current === requestId) setAudioLoading(false); }
  };

  const revealNativeMeaning = async (): Promise<void> => {
    if (!question || meaningStatus === "loading") return;
    if (meaningExpanded && meaningStatus === "ready") {
      setMeaningExpanded(false);
      return;
    }
    setMeaningExpanded(true);
    if (nativeMeaning) {
      setMeaningStatus("ready");
      return;
    }
    setMeaningStatus("loading");
    const requestId = meaningRequestRef.current + 1;
    meaningRequestRef.current = requestId;
    void Haptics.selectionAsync().catch(() => undefined);
    try {
      const result = await getCardMemorySentenceMeaning({
        recordId: question.recordId,
        contentType: question.contentType,
        contentVersion: question.contentVersion,
        segmentId: question.segmentId,
      });
      if (!mountedRef.current || meaningRequestRef.current !== requestId) return;
      if (!result.meaning) {
        setMeaningExpanded(false);
        setMeaningStatus("idle");
        setMeaningUnavailable(true);
        return;
      }
      setNativeMeaning(result.meaning);
      setMeaningStatus("ready");
    } catch {
      if (!mountedRef.current || meaningRequestRef.current !== requestId) return;
      setMeaningExpanded(false);
      setMeaningStatus("error");
    }
  };

  const pronunciation = useMemoryPronunciation({
    active: phase === "playing" && question?.kind === "speech" && !question.completed,
    referenceText: question?.kind === "speech" ? question.sentence : "",
    languageCode: question?.kind === "speech" ? question.languageCode : "en-US",
    onPassed: () => {
      if (!question || question.kind !== "speech") return;
      completeQuestion(question.firstAttemptCorrect ?? true);
    },
    onNeedsRetry: (assessment) => {
      if (!question || question.kind !== "speech" || !assessment) return;
      recordFirstAttempt(false);
      playWrongFeedback();
    },
  });

  const skipSpeechQuestion = async (): Promise<void> => {
    if (!round || !question || question.kind !== "speech") return;
    pronunciation.cancel();
    sentenceAudioRequestRef.current += 1;
    stopTtsAudio({ resetControls: true });
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
    const next = {
      ...round,
      currentIndex: nextIndex,
      questions: round.questions.map((item, index) => index > round.currentIndex && item.kind === "speech"
        ? {
            ...item,
            kind: item.speechFallbackKind ?? "choice",
            answer: item.answer === item.sentence ? recoverSpeechFallbackAnswer(item) : item.answer,
            speechFallbackKind: undefined,
          }
        : item),
    };
    setRound(next);
    if (ownerId) await persistRound(ownerId, next);
  };

  const speechBusy = question?.kind === "speech" && (pronunciation.status === "recording" || pronunciation.status === "evaluating");

  if (phase === "loading") return <SafeAreaView style={styles.page}><Header onClose={onClose} /><View style={styles.center}><ActivityIndicator color="#5E7C6A" /><Text style={styles.loadingText}>{t("memory_round.loading")}</Text></View></SafeAreaView>;
  if (phase === "error") return <SafeAreaView style={styles.page}><Header onClose={onClose} /><View style={styles.center}><Text style={styles.emptyTitle}>{t("memory_round.load_failed")}</Text><Pressable style={({ pressed }) => [styles.lightButton, pressed && styles.controlPressed]} onPress={() => void start()}><Text style={styles.lightButtonText}>{t("common.retry")}</Text></Pressable></View></SafeAreaView>;
  if (phase === "empty") return <SafeAreaView style={styles.page}><Header onClose={onClose} /><View style={styles.center}><View style={styles.emptyGlyph}><Ionicons name="sparkles-outline" size={28} color="#7A6E9D" /></View><Text style={styles.emptyTitle}>{t("memory_round.empty_title")}</Text><Text style={styles.emptyText}>{t("memory_round.empty_text")}</Text><Pressable style={({ pressed }) => [styles.lightButton, pressed && styles.controlPressed]} onPress={onOpenLibrary}><Text style={styles.lightButtonText}>{t("memory_round.go_cards")}</Text><Ionicons name="arrow-forward" size={17} color="#4F6557" /></Pressable></View></SafeAreaView>;
  if (phase === "summary") return <SafeAreaView style={styles.summaryPage}><Header onClose={onClose} /><View style={styles.summaryBody}><View style={styles.finishRoute}>{Array.from({ length: Math.max(1, summaryTotal) }, (_, index) => { const color = ["#8FD5C2", "#8CC8F0", "#F5BC91", "#B5A1E6"][index % 4]!; return <React.Fragment key={index}>{index ? <View style={[styles.finishConnector, { backgroundColor: color }]} /> : null}<View style={[styles.finishNode, { backgroundColor: color }]} /></React.Fragment>; })}</View><Text style={styles.summaryTitle}>{t("memory_round.finished")}</Text><Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]} onPress={onClose}><Text style={styles.primaryButtonText}>{t("memory_round.done")}</Text></Pressable><Pressable style={({ pressed }) => [styles.againButton, pressed && styles.secondaryPressed]} onPress={() => void start()}><Text style={styles.againButtonText}>{t("memory_round.again")}</Text></Pressable></View></SafeAreaView>;
  if (!round || !question) return null;

  const currentColor = ["#8FD5C2", "#8CC8F0", "#F5BC91", "#B5A1E6"][round.currentIndex % 4]!;
  const sentenceTypography = memorySentenceTypography(question.sentence);
  return <SafeAreaView style={[styles.page, { backgroundColor: `${currentColor}20` }]}>
    <Header onClose={onClose} onOpenCard={() => onOpenCard(question.recordId)} />
    <Progress total={round.questions.length} current={round.currentIndex} currentCompleted={question.completed} pulse={pulse} completion={success} colors={["#8FD5C2", "#8CC8F0", "#F5BC91", "#B5A1E6"]} />
    <Animated.View style={[styles.questionPage, { opacity: transition, transform: [{ translateY: transition.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      <ScrollView contentContainerStyle={[styles.questionScroll, compactLayout && styles.questionScrollCompact]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {question.thumbnailUrl && !failedImageQuestionIds.has(question.id) ? <Image source={{ uri: question.thumbnailUrl }} resizeMode="cover" style={[styles.memoryImage, compactLayout && styles.memoryImageCompact]} onError={() => setFailedImageQuestionIds((current) => new Set(current).add(question.id))} /> : <View style={[styles.titlePrompt, compactLayout && styles.titlePromptCompact]}><View style={[styles.titleDot, { backgroundColor: currentColor }]} /><Text style={styles.titlePromptText}>{question.title}</Text></View>}
        <View style={[styles.coachStage, compactLayout && styles.coachStageCompact, meaningExpanded && meaningStatus === "ready" && styles.coachStageExpanded, { borderColor: `${currentColor}90`, backgroundColor: `${currentColor}24` }]}>
          <View style={[styles.coachGlow, { backgroundColor: `${currentColor}4D` }]} />
          <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.coachCharacter}>
            <Animated.View style={{ transform: [{ translateX: reduceMotion ? 0 : wrongOffset.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }) }] }}>
            <Animated.View style={{ transform: [{ translateY: question.completed && !reduceMotion ? success.interpolate({ inputRange: [0, 0.55, 1], outputRange: [5, -7, -2] }) : reduceMotion ? 0 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] }) }, { scale: question.completed && !reduceMotion ? success.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0.96, 1.07, 1] }) : 1 }] }}>
              <OioCharacter width={compactLayout ? 52 : 58} height={compactLayout ? 48 : 54} />
            </Animated.View>
            </Animated.View>
          </Animated.View>
          <View style={[styles.coachBubble, meaningExpanded && meaningStatus === "ready" && styles.coachBubbleExpanded, feedbackState === "correct" && styles.coachBubbleSuccess, feedbackState === "wrong" && styles.coachBubbleWrong]}>
            {feedbackState === "correct" ? <Ionicons name="sparkles" size={19} color="#43816E" /> : feedbackState === "wrong" ? <Ionicons name="refresh" size={19} color="#B75F5F" /> : <>
              <Text style={styles.coachHintTitle}>{t("memory_round.coach_hint")}</Text>
              <View style={styles.coachHintActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("memory_round.play_audio")} disabled={audioLoading || speechBusy} style={({ pressed }) => [styles.coachHintButton, (audioLoading || speechBusy) && styles.buttonDisabled, pressed && styles.controlPressed]} onPress={() => void playSentence()}>
                  {audioLoading ? <ActivityIndicator size="small" color="#59636E" /> : <Ionicons name="volume-medium-outline" size={17} color="#596F65" />}
                  <Text style={styles.coachHintButtonText}>{t("memory_round.listen_hint")}</Text>
                </Pressable>
                {!meaningUnavailable ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: meaningExpanded, busy: meaningStatus === "loading" }} style={({ pressed }) => [styles.coachHintButton, pressed && styles.controlPressed]} onPress={() => void revealNativeMeaning()}>
                  {meaningStatus === "loading" ? <View style={styles.meaningDots}>{meaningDots.map((dot, index) => <Animated.View key={index} style={[styles.meaningDot, { opacity: dot }]} />)}</View> : <Ionicons name={meaningStatus === "error" ? "refresh" : "language-outline"} size={16} color={meaningStatus === "error" ? "#8A6F68" : "#596F65"} />}
                  <Text style={[styles.coachHintButtonText, meaningStatus === "error" && styles.meaningRetry]}>{meaningStatus === "error" ? t("memory_round.meaning_retry") : t("memory_round.native_meaning")}</Text>
                </Pressable> : null}
              </View>
              {audioUnavailable ? <Text style={styles.coachHintError}>{t("memory_round.audio_unavailable")}</Text> : null}
              {meaningExpanded && meaningStatus === "ready" && nativeMeaning ? <ScrollView style={styles.coachMeaningScroll} contentContainerStyle={styles.coachMeaningScrollContent} nestedScrollEnabled showsVerticalScrollIndicator persistentScrollbar>
                <Text style={styles.coachMeaningText}>{nativeMeaning}</Text>
              </ScrollView> : null}
            </>}
          </View>
        </View>
        <Animated.View style={{ transform: [{ translateX: wrongOffset.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] }}>
        {question.kind === "speech" ? question.completed ? <View style={styles.completedSentenceCard}><Text style={[styles.completedSentence, sentenceTypography]}>{question.sentence}</Text></View> : <>
          <View style={styles.speechSentenceCard}><Text style={[styles.sentence, sentenceTypography]}>{question.sentence}</Text></View>
          <View style={styles.speechPanel}>
            <View style={[styles.speechPulseOuter, pronunciation.status === "recording" && { transform: [{ scale: 1 + Math.min(0.12, pronunciation.audioLevel * 0.5) }], borderColor: "#79B9A3" }]}>
              <Ionicons name={pronunciation.status === "recording" ? "mic" : pronunciation.status === "evaluating" ? "hourglass-outline" : "mic-outline"} size={29} color={pronunciation.status === "retry" || pronunciation.status === "error" ? "#B75F5F" : "#4E786A"} />
            </View>
            <Text style={styles.speechStatus}>{t(`memory_round.speech_${pronunciation.status}`)}</Text>
            {pronunciation.status === "evaluating" || pronunciation.status === "preparing" ? <ActivityIndicator size="small" color="#668C7E" style={styles.speechSpinner} /> : null}
            <Pressable disabled={pronunciation.status === "preparing" || pronunciation.status === "evaluating"} style={({ pressed }) => [styles.speechButton, (pronunciation.status === "preparing" || pronunciation.status === "evaluating") && styles.buttonDisabled, pronunciation.status === "recording" && styles.speechButtonRecording, pressed && styles.primaryPressed]} onPress={() => { if (pronunciation.status === "recording") void pronunciation.stop(); else { sentenceAudioRequestRef.current += 1; stopTtsAudio({ resetControls: true }); setAudioLoading(false); void pronunciation.start(); } }}>
              <Ionicons name={pronunciation.status === "recording" ? "stop" : "mic"} size={19} color="#FFFFFF" />
              <Text style={styles.checkButtonText}>{pronunciation.status === "recording" ? t("memory_round.speech_finish") : pronunciation.status === "retry" || pronunciation.status === "error" ? t("memory_round.try_again") : t("memory_round.speech_start")}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.speechSkip, pressed && styles.secondaryPressed]} onPress={() => void skipSpeechQuestion()}><Text style={styles.speechSkipText}>{t("memory_round.speech_skip")}</Text></Pressable>
          </View>
        </> : question.kind === "choice" ? <>
          <View style={styles.sentenceSurface}><Text accessibilityLabel={question.completed ? question.sentence : `${question.before} … ${question.after}`} style={[styles.sentence, sentenceTypography]}>{question.before}<Text style={[styles.blank, !question.completed && styles.blankHidden]}>{question.answer}</Text>{question.after}</Text></View>
          <View style={styles.options}>{question.options.map((option) => {
            const disabled = question.disabledOptions.includes(option);
            const isAnswer = question.completed && normalizeAnswer(option) === normalizeAnswer(question.answer);
            return <Pressable key={option} disabled={disabled || question.completed || checking} style={({ pressed }) => [styles.option, pressed && styles.optionPressed, disabled && styles.optionWrong, isAnswer && styles.optionCorrect]} onPress={() => void chooseOption(option)}><Text style={[styles.optionText, memoryOptionTypography(option), disabled && styles.optionWrongText, isAnswer && styles.optionCorrectText]}>{option}</Text>{disabled ? <Ionicons name="close" size={20} color="#D56E6E" /> : isAnswer ? <Ionicons name="checkmark" size={20} color="#43816E" /> : null}</Pressable>;
          })}</View>
        </> : question.kind === "input" ? question.completed ? <View style={styles.completedSentenceCard}><Text style={[styles.completedSentence, sentenceTypography]}>{question.sentence}</Text></View> : <>
          <View style={styles.sentenceSurface}><Text accessibilityLabel={`${question.before} … ${question.after}`} style={[styles.sentence, sentenceTypography]}>{question.before}<Text style={styles.inputBlank}>______</Text>{question.after}</Text></View>
          <View style={[styles.inputAnswerShell, sentenceIncorrect && styles.inputAnswerShellWrong]}>
            <TextInput
              ref={inputAnswerRef}
              value={inputAnswer}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              blurOnSubmit={false}
              enterKeyHint="done"
              returnKeyType="done"
              placeholder={t("memory_round.type_answer")}
              placeholderTextColor="#9AA49F"
              selectionColor="#6FAE99"
              style={styles.inputAnswer}
              onChangeText={(value) => { setInputAnswer(value); setSentenceIncorrect(false); setFeedbackState("idle"); }}
              onSubmitEditing={checkInputAnswer}
            />
            {inputAnswer ? <Pressable accessibilityRole="button" accessibilityLabel={t("memory_round.clear_answer")} hitSlop={8} style={({ pressed }) => [styles.inputClear, pressed && styles.headerPressed]} onPress={() => { void Haptics.selectionAsync().catch(() => undefined); setInputAnswer(""); setSentenceIncorrect(false); setFeedbackState("idle"); inputAnswerRef.current?.focus(); }}><Ionicons name="close-circle" size={20} color="#87938D" /></Pressable> : null}
          </View>
          <Pressable disabled={!inputAnswer.trim() || checking} style={({ pressed }) => [styles.checkButton, !inputAnswer.trim() && styles.buttonDisabled, sentenceIncorrect && styles.checkButtonWrong, pressed && styles.primaryPressed]} onPress={checkInputAnswer}><Text style={styles.checkButtonText}>{sentenceIncorrect ? t("memory_round.try_again") : t("memory_round.check")}</Text></Pressable>
        </> : question.completed ? <View style={styles.completedSentenceCard}><Text style={[styles.completedSentence, sentenceTypography]}>{question.sentence}</Text></View> : <>
          <View style={[styles.sentenceTray, sentenceIncorrect && styles.sentenceTrayWrong]}>{selectedTokens.length ? <View style={styles.tokenWrap}>{selectedTokens.map((token) => <Pressable key={token.id} style={({ pressed }) => [styles.selectedToken, pressed && styles.tokenPressed]} onPress={() => changeSentenceToken(token.id, false)}><Text style={styles.selectedTokenText}>{token.text.trim()}</Text></Pressable>)}</View> : <Text style={styles.trayHint}>{t("memory_round.tap_words")}</Text>}</View>
          <View style={styles.tokenWrap}>{availableTokens.map((token) => <Pressable key={token.id} style={({ pressed }) => [styles.token, pressed && styles.tokenPressed]} onPress={() => changeSentenceToken(token.id, true)}><Text style={styles.tokenText}>{token.text.trim()}</Text></Pressable>)}</View>
          <Pressable disabled={selectedTokens.length !== question.tokens.length || checking} style={({ pressed }) => [styles.checkButton, selectedTokens.length !== question.tokens.length && styles.buttonDisabled, sentenceIncorrect && styles.checkButtonWrong, pressed && styles.primaryPressed]} onPress={() => void checkSentence()}><Text style={styles.checkButtonText}>{sentenceIncorrect ? t("memory_round.try_again") : t("memory_round.check")}</Text></Pressable>
        </>}
        </Animated.View>
        {question.completed ? <Animated.View style={[styles.completionActions, { opacity: success, transform: [{ translateY: success.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }, { scale: success.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0.97, 1.015, 1] }) }] }]}><View style={styles.successMark}><Ionicons name="checkmark" size={20} color="#FFFFFF" /></View><Pressable style={({ pressed }) => [styles.continueButton, pressed && styles.primaryPressed]} onPress={() => void continueRound()}><Text style={styles.primaryButtonText}>{t("common.continue")}</Text><Ionicons name="arrow-forward" size={18} color="#FFFFFF" /></Pressable></Animated.View> : null}
      </ScrollView>
    </Animated.View>
  </SafeAreaView>;
}

function Header({ onClose, onOpenCard }: { onClose: () => void; onOpenCard?: () => void }) {
  return <View style={styles.header}><Pressable accessibilityRole="button" style={({ pressed }) => [styles.headerButton, pressed && styles.headerPressed]} onPress={onClose}><Ionicons name="close" size={24} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{t("memory_round.title")}</Text>{onOpenCard ? <Pressable accessibilityRole="button" accessibilityLabel={t("memory_round.view_card")} style={({ pressed }) => [styles.headerCardButton, pressed && styles.headerPressed]} onPress={onOpenCard}><Text style={styles.headerCardButtonText}>{t("memory_round.original_card")}</Text></Pressable> : <View style={styles.headerButton} />}</View>;
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
      canBuildMemorySentencePuzzle(group.segment.text) && (group.blanks.length >= 2 || isDenseMemoryCloze(group.segment.text, group.blanks)),
    ))[0];
    if (dense) return [baseQuestion(candidate, dense.segment.id, dense.segment.text, {
      kind: "sentence",
      answer: dense.segment.text,
      blankIds: dense.blanks.map((blank) => blank.id),
      tokens: shuffle(memorySentenceTokens(dense.segment.text)),
    })];
    const regular = shuffle(preferredGroups.flatMap((group) => group.blanks.map((blank) => ({ segment: group.segment, blank })) ))[0];
    if (!regular) return [];
    const start = Math.max(0, Math.min(regular.segment.text.length, regular.blank.startUtf16));
    const end = Math.max(start, Math.min(regular.segment.text.length, regular.blank.endUtf16));
    const answer = regular.segment.text.slice(start, end) || regular.blank.answer;
    const normalizedSentence = normalizeAnswer(regular.segment.text);
    const distractors = shuffle(blanks
      .filter((item) => item.candidate.recordId !== candidate.recordId && sameMemoryLanguageFamily(item.candidate.languageCode, candidate.languageCode))
      .map((item) => item.blank.answer)
      .filter((answer, index, all) => isCompatibleDistractor(regular.blank.answer, answer) && !normalizedSentence.includes(normalizeAnswer(answer)) && all.findIndex((item) => normalizeAnswer(item) === normalizeAnswer(answer)) === index))
      .slice(0, 2);
    if (isSingleMemoryWord(answer, candidate.languageCode) && (!distractors.length || Math.random() < 0.5)) return [baseQuestion(candidate, regular.segment.id, regular.segment.text, {
      kind: "input",
      blankIds: [regular.blank.id],
      before: regular.segment.text.slice(0, start),
      answer,
      after: regular.segment.text.slice(end),
    })];
    if (!distractors.length) return [];
    return [baseQuestion(candidate, regular.segment.id, regular.segment.text, {
      kind: "choice",
      blankIds: [regular.blank.id],
      before: regular.segment.text.slice(0, start),
      answer,
      after: regular.segment.text.slice(end),
      options: shuffle([answer, ...distractors]),
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

function isSingleMemoryWord(value: string, languageCode: string): boolean {
  const answer = value.normalize("NFKC").trim();
  if (!answer || /\s/u.test(answer)) return false;
  const length = Array.from(answer.replace(/[\p{P}\p{S}]/gu, "")).length;
  const language = languageCode.toLowerCase().split("-")[0];
  if (language === "zh") return length >= 1 && length <= 4;
  if (language === "ja") return length >= 1 && length <= 7;
  return length >= 1 && length <= 32;
}

function assignSpeechQuestions(questions: MemoryQuestion[]): MemoryQuestion[] {
  if (questions.length < 3) return questions;
  const targetCount = questions.length >= 6 && Math.random() < 0.5 ? 2 : 1;
  const selected = new Set<number>();
  for (const index of shuffle(questions.map((_, index) => index))) {
    if ([...selected].some((current) => Math.abs(current - index) <= 1)) continue;
    selected.add(index);
    if (selected.size >= targetCount) break;
  }
  return questions.map((question, index) => selected.has(index) && question.kind !== "speech"
    ? { ...question, kind: "speech", speechFallbackKind: question.kind, selectedTokenIds: [], disabledOptions: [] }
    : question);
}

function recoverSpeechFallbackAnswer(question: MemoryQuestion): string {
  if (question.speechFallbackKind === "sentence") return question.sentence;
  const start = question.before.length;
  const end = Math.max(start, question.sentence.length - question.after.length);
  return question.sentence.slice(start, end);
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
    && (question.kind === "choice" || question.kind === "sentence" || question.kind === "input" || question.kind === "speech")
    && (question.speechFallbackKind === undefined || question.speechFallbackKind === "choice" || question.speechFallbackKind === "sentence" || question.speechFallbackKind === "input")
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
  headerPressed: { opacity: 0.55, transform: [{ scale: 0.94 }] },
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
  questionScrollCompact: { paddingBottom: 32 },
  memoryImage: { width: "100%", height: 164, marginTop: 8, borderRadius: 22, backgroundColor: "#E8ECEB" },
  memoryImageCompact: { height: 128, borderRadius: 18 },
  titlePrompt: { minHeight: 72, marginTop: 8, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.72)", flexDirection: "row", alignItems: "center", gap: 12 },
  titlePromptCompact: { minHeight: 58, paddingVertical: 10, borderRadius: 17 },
  titleDot: { width: 10, height: 10, borderRadius: 5 },
  titlePromptText: { flex: 1, color: theme.colors.text, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  coachStage: { minHeight: 84, marginTop: 10, marginBottom: 12, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, overflow: "hidden", flexDirection: "row", alignItems: "flex-end", gap: 8 },
  coachStageCompact: { minHeight: 76, marginTop: 7, marginBottom: 9, borderRadius: 17, paddingVertical: 8 },
  coachStageExpanded: { minHeight: 122, alignItems: "center" },
  coachGlow: { position: "absolute", left: 16, width: 78, height: 38, bottom: -23, borderRadius: 39 },
  coachCharacter: { width: 62, alignSelf: "stretch", alignItems: "center", justifyContent: "flex-end" },
  coachBubble: { flex: 1, minHeight: 58, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, borderBottomLeftRadius: 5, borderWidth: 1, borderColor: "rgba(80,100,92,0.13)", backgroundColor: "rgba(255,255,255,0.92)", alignItems: "stretch", justifyContent: "center", shadowColor: "#52645D", shadowOpacity: 0.08, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  coachBubbleExpanded: { alignSelf: "stretch" },
  coachBubbleSuccess: { borderColor: "#A9D7C8", backgroundColor: "#ECF8F3" },
  coachBubbleWrong: { borderColor: "#EDBBB4", backgroundColor: "#FFF2F0" },
  coachHintTitle: { color: "#6B7872", fontSize: 12, lineHeight: 16, fontWeight: "500" },
  coachHintActions: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 6 },
  coachHintButton: { minHeight: 29, paddingHorizontal: 8, borderRadius: 10, backgroundColor: "#F1F6F3", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  coachHintButtonText: { color: "#596F65", fontSize: 12, fontWeight: "600" },
  coachHintError: { marginTop: 5, color: theme.colors.textMuted, fontSize: 11 },
  coachMeaningScroll: { maxHeight: 92, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(80,100,92,0.13)" },
  coachMeaningScrollContent: { paddingTop: 8, paddingRight: 5, paddingBottom: 2 },
  coachMeaningText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  controlPressed: { opacity: 0.76, transform: [{ translateY: 1 }, { scale: 0.96 }] },
  sentenceSurface: { paddingHorizontal: 18, paddingVertical: 17, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(78,98,89,0.13)", backgroundColor: "rgba(255,255,255,0.76)" },
  sentence: { color: theme.colors.text, fontSize: 20, lineHeight: 31, fontWeight: "400" },
  blank: { color: "#397461", textDecorationLine: "underline", textDecorationColor: "#72A18F" },
  blankHidden: { color: "transparent" },
  inputBlank: { color: "#78A493", letterSpacing: 1 },
  inputAnswerShell: { minHeight: 56, marginTop: 14, paddingLeft: 17, paddingRight: 12, borderRadius: 17, borderWidth: 1.5, borderColor: "#9FC7B9", backgroundColor: "rgba(255,255,255,0.94)", flexDirection: "row", alignItems: "center", shadowColor: "#52645D", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  inputAnswerShellWrong: { borderColor: "#DF8A82", backgroundColor: "#FFF4F2" },
  inputAnswer: { flex: 1, minHeight: 54, paddingVertical: 10, color: theme.colors.text, fontSize: 18, lineHeight: 24, fontWeight: "500" },
  inputClear: { width: 34, height: 40, alignItems: "flex-end", justifyContent: "center" },
  meaningRetry: { color: "#8A6F68", fontSize: 12, fontWeight: "500" },
  meaningDots: { height: 12, marginLeft: 2, flexDirection: "row", alignItems: "center", gap: 4 },
  meaningDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#739889" },
  speechSentenceCard: { paddingHorizontal: 18, paddingVertical: 17, borderRadius: 20, borderWidth: 1, borderColor: "#CFE0DA", backgroundColor: "rgba(255,255,255,0.86)" },
  speechPanel: { marginTop: 16, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 12, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.72)", alignItems: "center" },
  speechPulseOuter: { width: 66, height: 66, borderRadius: 33, borderWidth: 5, borderColor: "#CFE5DD", backgroundColor: "#EEF7F3", alignItems: "center", justifyContent: "center" },
  speechStatus: { minHeight: 42, marginTop: 12, color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
  speechSpinner: { position: "absolute", top: 99 },
  speechButton: { alignSelf: "stretch", minHeight: 52, marginTop: 10, borderRadius: 17, backgroundColor: "#5E7E72", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  speechButtonRecording: { backgroundColor: "#B96F68" },
  speechSkip: { minHeight: 42, marginTop: 5, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  speechSkipText: { color: "#718078", fontSize: 14, fontWeight: "500" },
  options: { marginTop: 14, gap: 10 },
  option: { minHeight: 54, paddingHorizontal: 17, paddingVertical: 10, borderRadius: 17, borderWidth: 1.25, borderColor: "rgba(93,113,104,0.17)", backgroundColor: "rgba(255,255,255,0.88)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", shadowColor: "#52645D", shadowOpacity: 0.055, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  optionPressed: { opacity: 0.86, transform: [{ translateY: 2 }, { scale: 0.975 }], shadowOpacity: 0.01, elevation: 0 },
  optionText: { flex: 1, paddingRight: 10, color: theme.colors.text, fontSize: 17, lineHeight: 24, fontWeight: "400" },
  optionWrong: { borderColor: "#E59A91", backgroundColor: "#FBE8E5" },
  optionWrongText: { color: "#B75F5F", textDecorationLine: "line-through" },
  optionCorrect: { borderColor: "#7BC4AC", backgroundColor: "#DDF3EA" },
  optionCorrectText: { color: "#397461" },
  sentenceTray: { minHeight: 130, padding: 14, borderRadius: 20, borderWidth: 1.5, borderColor: "#D6E2DD", backgroundColor: "rgba(255,255,255,0.78)", justifyContent: "center" },
  sentenceTrayWrong: { borderColor: "#DF8A82", backgroundColor: "#FBEAE7" },
  trayHint: { color: theme.colors.textMuted, fontSize: 15, textAlign: "center" },
  tokenWrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  token: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "#D7DBE3", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#53615B", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  tokenText: { color: theme.colors.text, fontSize: 16, fontWeight: "400" },
  selectedToken: { minHeight: 38, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "#DCEDE8", alignItems: "center", justifyContent: "center" },
  selectedTokenText: { color: "#365E52", fontSize: 16, fontWeight: "400" },
  tokenPressed: { opacity: 0.78, transform: [{ translateY: 2 }, { scale: 0.96 }] },
  checkButton: { minHeight: 52, marginTop: 22, borderRadius: 17, backgroundColor: "#687E75", alignItems: "center", justifyContent: "center" },
  checkButtonWrong: { backgroundColor: "#C77870" },
  checkButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  buttonDisabled: { opacity: 0.35 },
  primaryPressed: { opacity: 0.88, transform: [{ translateY: 2 }, { scale: 0.985 }] },
  secondaryPressed: { opacity: 0.62, transform: [{ scale: 0.97 }] },
  completedSentenceCard: { marginTop: 8, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: "#CFE5DC", backgroundColor: "rgba(255,255,255,0.84)" },
  completedSentence: { color: "#397461", fontSize: 20, lineHeight: 31, fontWeight: "400" },
  completionActions: { marginTop: 24, position: "relative" },
  successMark: { position: "absolute", zIndex: 1, top: -13, alignSelf: "center", width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: "#F7FBF9", backgroundColor: "#64AE96", alignItems: "center", justifyContent: "center", shadowColor: "#477766", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
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
