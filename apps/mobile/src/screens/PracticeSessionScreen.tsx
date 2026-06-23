import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Alert,
  Keyboard,
  PanResponder,
  Pressable,
  NativeSyntheticEvent,
  NativeScrollEvent,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ChatMessage } from "../domain/chat/types";
import { BlockingLoading, type BlockingLoadingOptions, runWithDeferredBlockingLoading } from "./shared/BlockingLoading";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import {
  applyCorrectAnswers,
  buildPracticeCards,
  getBlankAnswers,
  type PracticeCard,
} from "../domain/practice/practiceService";
import { discardMessageClozePractice, updateMessageClozeState } from "../services/api/chatHistoryApi";
import { loadChatMessagesByDate, replaceChatMessagesByDate } from "../services/chat/chatSessionService";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
import { getMessageDateKey } from "../domain/chat/messageState";
import { getChatContact } from "../domain/chat/contacts";
import { markChatDateDirty, markPracticeStatsDirty } from "../services/chat/chatPracticeSyncState";
import { t } from "../i18n";
import { TtsPlayButton } from "../components/TtsPlayButton";
import { getMessageTtsAsset } from "../services/api/ttsApi";
import { playTtsAudio, stopTtsAudio } from "../services/tts/ttsPlayback";
import { segmentLearningSentences } from "../domain/learning/learningText";

type PracticeSessionScreenProps = {
  initialCards: PracticeCard[];
  allMessages: ChatMessage[];
  onBack: () => void;
};

type PracticeEnglishSegment =
  | {
      type: "text";
      key: string;
      text: string;
      highlighted: boolean;
      correct: boolean;
      spacer: boolean;
      spacerHighlighted: boolean;
      textStart: number;
      textEnd: number;
    }
  | {
      type: "blank";
      key: string;
      tokenIndex: number;
      width: number;
      spacer: boolean;
      spacerHighlighted: boolean;
      expectedText: string;
      textStart: number;
      textEnd: number;
    };

const EDGE_SWITCH_COMMIT_THRESHOLD = 5;
const DISCARD_SWIPE_RATIO = 0.15;
const TOUCH_AXIS_LOCK_THRESHOLD = 8;
const ACTIVE_BLANK_KEYBOARD_GAP = 88;

function buildPracticeEnglishSegments(card: PracticeCard): PracticeEnglishSegment[] {
  const phraseSet = new Set(card.phraseTokenIndexes);
  const blankSet = new Set(card.blankTokenIndexes);
  const correctSet = new Set(card.correctTokenIndexes);
  return card.tokens.map((token, tokenListIndex) => {
    const isPhrase = phraseSet.has(token.index);
    const isAnsweredBlank = blankSet.has(token.index) && correctSet.has(token.index);
    const isBlank = blankSet.has(token.index) && !correctSet.has(token.index);
    const previous = card.tokens[tokenListIndex - 1];
    const spacer = !!previous && token.kind === "word" && previous.kind === "word";
    const spacerHighlighted = spacer && isPhrase && phraseSet.has(previous.index);
    if (isBlank) {
      return {
        type: "blank",
        key: `blank-${token.index}`,
        tokenIndex: token.index,
        width: Math.max(36, token.text.length * 10),
        spacer,
        spacerHighlighted,
        expectedText: token.text,
        textStart: token.start,
        textEnd: token.end,
      };
    }
    return {
      type: "text",
      key: `text-${token.index}`,
      text: token.text,
      highlighted: isPhrase || isAnsweredBlank,
      correct: isAnsweredBlank,
      spacer,
      spacerHighlighted,
      textStart: token.start,
      textEnd: token.end,
    };
  });
}

type PracticeSentenceRow = {
  key: string;
  textStart: number;
  textEnd: number;
  segments: PracticeEnglishSegment[];
};

function groupPracticeEnglishSentences(card: PracticeCard, segments: PracticeEnglishSegment[]): PracticeSentenceRow[] {
  const sentenceSegments = segmentLearningSentences({
    text: card.sourceText,
    languageCode: card.languageCode,
    minSegmentChars: 1,
  });
  const rows = sentenceSegments
    .map((sentence, index) => ({
      key: `${card.id}:sentence-${index}-${sentence.textStart}-${sentence.textEnd}`,
      textStart: sentence.textStart,
      textEnd: sentence.textEnd,
      segments: segments.filter((segment) => segment.textEnd > sentence.textStart && segment.textStart < sentence.textEnd),
    }))
    .filter((row) => row.segments.length > 0);
  if (rows.length) return rows;
  if (!segments.length) return [];
  return [{
    key: `${card.id}:sentence-fallback`,
    textStart: card.textStart,
    textEnd: card.textEnd,
    segments,
  }];
}

export function PracticeSessionScreen({ initialCards, allMessages, onBack }: PracticeSessionScreenProps) {
  const window = useWindowDimensions();
  const [cards, setCards] = useState(initialCards);
  const [messages, setMessages] = useState(allMessages);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checkedAnswers, setCheckedAnswers] = useState<Record<number, "correct" | "incorrect">>({});
  const [isFlipped, setIsFlipped] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [keyboardScrollPadding, setKeyboardScrollPadding] = useState(0);
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const [canUseTts, setCanUseTts] = useState(false);
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const flipAnim = useRef(new Animated.Value(0)).current;
  const cardMotionLocked = useRef(false);
  const segmentCacheRef = useRef(new Map<string, PracticeEnglishSegment[]>());
  const gestureAxis = useRef<"x" | null>(null);
  const englishScrollRef = useRef<ScrollView | null>(null);
  const activeBlankInputRef = useRef<TextInput | null>(null);
  const sentenceTtsControllerRef = useRef<AbortController | null>(null);
  const practiceMountedRef = useRef(true);
  const keyboardTopRef = useRef<number | null>(null);
  const isFlippedRef = useRef(false);
  const sessionMessageIdsRef = useRef(new Set(initialCards.map((row) => row.messageId)));
  const sessionContactByMessageIdRef = useRef(new Map(initialCards.map((row) => [row.messageId, getChatContact(row.contactId)])));
  const scrollStateRef = useRef({ y: 0, contentHeight: 0, layoutHeight: 0, maxY: 0 });
  // ScrollView 负责纵向滚动；这里仅记录触摸轨迹，用于滚到顶/底后松手切卡。
  const scrollEdgeDragRef = useRef<{
    startX: number;
    startY: number;
    axis: "x" | "y" | null;
    direction: "prev" | "next" | null;
    distance: number;
  } | null>(null);
  const card = cards[index] ?? null;
  const canFlipCard = !!card?.translation.trim();
  isFlippedRef.current = isFlipped;

  const stopPracticeTts = React.useCallback(() => {
    sentenceTtsControllerRef.current?.abort();
    sentenceTtsControllerRef.current = null;
    stopTtsAudio();
  }, []);

  useEffect(() => {
    return () => {
      practiceMountedRef.current = false;
      stopPracticeTts();
    };
  }, [stopPracticeTts]);

  useEffect(() => {
    if (!card) stopPracticeTts();
  }, [card?.id, stopPracticeTts]);

  useEffect(() => {
    let cancelled = false;
    hasLocalProAccess()
      .then((value) => {
        if (!cancelled) setCanUseTts(value);
      })
      .catch(() => {
        if (!cancelled) setCanUseTts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getCardSegments = (target: PracticeCard): PracticeEnglishSegment[] => {
    const cached = segmentCacheRef.current.get(target.id);
    if (cached) return cached;
    const segments = buildPracticeEnglishSegments(target);
    segmentCacheRef.current.set(target.id, segments);
    return segments;
  };

  const ensureActiveBlankVisible = React.useCallback((animated = true): void => {
    const keyboardTop = keyboardTopRef.current;
    const activeInput = activeBlankInputRef.current;
    if (!keyboardTop || !activeInput || isFlippedRef.current) return;
    requestAnimationFrame(() => {
      activeInput.measureInWindow((_x, y, _width, height) => {
        const visibleBottom = keyboardTop - ACTIVE_BLANK_KEYBOARD_GAP;
        const overlap = y + height - visibleBottom;
        if (overlap <= 0) return;
        const { y: currentY, maxY } = scrollStateRef.current;
        englishScrollRef.current?.scrollTo({
          y: Math.min(maxY, currentY + overlap),
          animated,
        });
      });
    });
  }, []);

  const handleBlankFocus = React.useCallback((inputRef: TextInput | null): void => {
    activeBlankInputRef.current = inputRef;
    setTimeout(() => ensureActiveBlankVisible(true), 80);
  }, [ensureActiveBlankVisible]);

  useEffect(() => {
    setIsFlipping(false);
    cardMotionLocked.current = false;
    if (isFlipped && canFlipCard) {
      flipAnim.setValue(1);
      return;
    }
    if (isFlipped) setIsFlipped(false);
    flipAnim.setValue(0);
  }, [card?.id, canFlipCard, flipAnim, isFlipped]);

  useEffect(() => {
    const keepIds = new Set<string>();
    [cards[index - 1], cards[index], cards[index + 1]].forEach((row) => {
      if (!row) return;
      keepIds.add(row.id);
      getCardSegments(row);
    });
    for (const key of segmentCacheRef.current.keys()) {
      if (!keepIds.has(key)) segmentCacheRef.current.delete(key);
    }
  }, [cards, index]);

  useEffect(() => {
    const didShow = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      setKeyboardScrollPadding(Math.max(0, window.height - event.endCoordinates.screenY + ACTIVE_BLANK_KEYBOARD_GAP));
      setTimeout(() => ensureActiveBlankVisible(true), 80);
    });
    const didHide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTopRef.current = null;
      activeBlankInputRef.current = null;
      setKeyboardScrollPadding(0);
    });

    return () => {
      didShow.remove();
      didHide.remove();
    };
  }, [ensureActiveBlankVisible, window.height]);

  const frontRotateY = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const backRotateY = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (cardMotionLocked.current || isFlipping) return false;
          return Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2 && Math.abs(gesture.dx) > 10;
        },
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          if (cardMotionLocked.current || isFlipping) return false;
          return Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35 && Math.abs(gesture.dx) > 18;
        },
        onPanResponderGrant: () => {
          gestureAxis.current = "x";
          translate.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: (_, gesture) => {
          translate.setValue({ x: Math.max(0, gesture.dx), y: 0 });
        },
        onPanResponderRelease: (_, gesture) => {
          const discardThreshold = window.width * DISCARD_SWIPE_RATIO;
          Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
          gestureAxis.current = null;
          if (gesture.dx > discardThreshold) {
            askDiscardCurrentCard();
          }
        },
        onPanResponderTerminate: () => {
          gestureAxis.current = null;
          Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
        },
      }),
    [isFlipping, window.width],
  );

  async function runWithLoading<T>(task: (signal: AbortSignal) => Promise<T>, text?: string): Promise<T> {
    return runWithDeferredBlockingLoading(
      task,
      { show: setLoadingOptions, hide: () => setLoadingOptions(null) },
      {
        text,
        blocking: true,
        abortable: true,
        cancelableAfterMs: 10000,
        timeoutMs: 20000,
        onTimeout: () => setDialog({ message: t("practice.timeout") }),
      },
    );
  }

  function askExit(): void {
    setDialog({
      message: t("practice.session.exit_confirm"),
      cancelText: t("common.cancel"),
      confirmText: t("common.confirm"),
      onConfirm: onBack,
    });
  }

  function askDiscardCurrentCard(): void {
    setDialog({
      message: t("practice.session.discard_confirm"),
      cancelText: t("common.cancel"),
      confirmText: t("practice.session.discard"),
      onConfirm: () => {
        void discardCurrentCard();
      },
    });
  }

  function resetMotion(): void {
    const { layoutHeight } = scrollStateRef.current;
    gestureAxis.current = null;
    scrollEdgeDragRef.current = null;
    scrollStateRef.current = { y: 0, contentHeight: 0, layoutHeight, maxY: 0 };
    translate.setValue({ x: 0, y: 0 });
  }

  function updateScrollState(next: Partial<typeof scrollStateRef.current>): void {
    const previous = scrollStateRef.current;
    const merged = { ...previous, ...next };
    // contentHeight 是内容高度，layoutHeight 是卡片可视高度；差值才是可滚动距离。
    merged.maxY = Math.max(0, merged.contentHeight - merged.layoutHeight);
    scrollStateRef.current = {
      ...merged,
      y: Math.max(0, Math.min(merged.y, merged.maxY)),
    };
  }

  function handleCardScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    updateScrollState({
      y: Math.max(0, contentOffset.y),
      contentHeight: contentSize.height,
      layoutHeight: layoutMeasurement.height,
    });
  }

  function handleCardPaneLayout(event: LayoutChangeEvent): void {
    updateScrollState({ layoutHeight: event.nativeEvent.layout.height });
  }

  function getEdgeSwitchDirection(dy: number): "prev" | "next" | null {
    const { y, maxY } = scrollStateRef.current;
    // 短卡 maxY 为 0，等价于同时处在顶部和底部；首尾卡仍要拦住不可达方向。
    if (maxY <= 1) {
      if (dy < 0 && index < cards.length - 1) return "next";
      if (dy > 0 && index > 0) return "prev";
      return null;
    }
    if (dy < 0 && y >= maxY - 1 && index < cards.length - 1) return "next";
    if (dy > 0 && y <= 1 && index > 0) return "prev";
    return null;
  }

  function handleCardScrollTouchStart(event: NativeSyntheticEvent<any>): void {
    scrollEdgeDragRef.current = {
      startX: event.nativeEvent.pageX,
      startY: event.nativeEvent.pageY,
      axis: null,
      direction: null,
      distance: 0,
    };
  }

  function handleCardScrollTouchMove(event: NativeSyntheticEvent<any>): void {
    const drag = scrollEdgeDragRef.current;
    if (!drag || cardMotionLocked.current || isFlipping) return;
    const dx = event.nativeEvent.pageX - drag.startX;
    const dy = event.nativeEvent.pageY - drag.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    // 右滑丢弃和上下切卡共用手指：先锁定主方向，横向手势不参与切卡，避免误触。
    if (!drag.axis && (absX > TOUCH_AXIS_LOCK_THRESHOLD || absY > TOUCH_AXIS_LOCK_THRESHOLD)) {
      drag.axis = absX > absY ? "x" : "y";
    }
    if (drag.axis === "x") {
      drag.direction = null;
      drag.distance = 0;
      return;
    }
    const direction = getEdgeSwitchDirection(dy);
    if (!direction) {
      drag.direction = null;
      drag.distance = 0;
      return;
    }
    const distance = Math.abs(dy);
    drag.direction = direction;
    drag.distance = distance;
  }

  function handleCardScrollTouchEnd(): void {
    const drag = scrollEdgeDragRef.current;
    scrollEdgeDragRef.current = null;
    // 只有从顶/底继续拖过提交阈值，松手才切卡；当前不再显示提示，靠手感触发。
    if (!drag || !drag.direction || drag.distance < EDGE_SWITCH_COMMIT_THRESHOLD) {
      return;
    }
    if (drag.direction === "next") {
      goNext();
    } else {
      goPrev();
    }
  }

  function resetCardState(): void {
    setAnswers({});
    setCheckedAnswers({});
    setIsFlipped(false);
    setIsFlipping(false);
    flipAnim.setValue(0);
  }

  function resetPracticeInputs(nextIndex?: number): void {
    setAnswers({});
    setCheckedAnswers({});
    setIsFlipping(false);
    if (nextIndex == null) return;
    const nextCardCanFlip = !!cards[nextIndex]?.translation.trim();
    if (isFlipped && nextCardCanFlip) {
      flipAnim.setValue(1);
      return;
    }
    if (isFlipped) setIsFlipped(false);
    flipAnim.setValue(0);
  }

  function rebuildSessionCards(nextMessages: ChatMessage[]): PracticeCard[] {
    return buildPracticeCards(nextMessages, {
      contactByMessageId: sessionContactByMessageIdRef.current,
    }).filter((row) => sessionMessageIdsRef.current.has(row.messageId));
  }

  function beginCardMotion(): boolean {
    if (cardMotionLocked.current) return false;
    cardMotionLocked.current = true;
    return true;
  }

  function endCardMotion(): void {
    cardMotionLocked.current = false;
  }

  function toggleFlip(): void {
    if (!canFlipCard || isFlipping || !beginCardMotion()) return;
    stopPracticeTts();
    const nextValue = isFlipped ? 0 : 1;
    setIsFlipping(true);
    Animated.timing(flipAnim, {
      toValue: nextValue,
      duration: 280,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setIsFlipped((value) => !value);
      setIsFlipping(false);
      endCardMotion();
    });
  }

  function goNext(): void {
    if (isFlipping || cardMotionLocked.current) return;
    if (index >= cards.length - 1) {
      resetMotion();
      return;
    }
    stopPracticeTts();
    const nextIndex = Math.min(cards.length - 1, index + 1);
    resetMotion();
    resetPracticeInputs(nextIndex);
    setIndex(nextIndex);
  }

  function goPrev(): void {
    if (isFlipping || cardMotionLocked.current) return;
    if (index <= 0) {
      resetMotion();
      return;
    }
    stopPracticeTts();
    const nextIndex = Math.max(0, index - 1);
    resetMotion();
    resetPracticeInputs(nextIndex);
    setIndex(nextIndex);
  }

  async function checkAnswers(): Promise<void> {
    if (!card) return;
    const answerMap = getBlankAnswers(card);
    const correct: number[] = [];
    const checked: Record<number, "correct" | "incorrect"> = {};
    for (const tokenIndex of card.blankTokenIndexes) {
      const expected = answerMap.get(tokenIndex)?.trim().toLowerCase();
      const actual = (answers[tokenIndex] ?? "").trim().toLowerCase();
      if (card.correctTokenIndexes.includes(tokenIndex)) {
        checked[tokenIndex] = "correct";
      } else if (expected && actual === expected) {
        correct.push(tokenIndex);
        checked[tokenIndex] = "correct";
      } else {
        checked[tokenIndex] = "incorrect";
      }
    }
    setCheckedAnswers(checked);
    if (!correct.length) {
      return;
    }

    // 只保存答对的空；错误输入不写库，直接清空留给用户重试。
    await runWithLoading(async () => {
      const baseVersion = card.message.clozeVersion ?? 0;
      const nextState = applyCorrectAnswers(card.message.clozeState, correct);
      const isPro = await hasLocalProAccess();
      const saved = isPro
        ? await updateMessageClozeState({
          messageId: card.message.id!,
          baseVersion,
          clozeState: nextState,
        })
        : { clozeState: nextState, clozeVersion: baseVersion + 1 };
      const matchesCardMessage = (row: ChatMessage) =>
        (card.message.id && row.id === card.message.id) || row.localId === card.message.localId;
      const nextMessages = messages.map((row) =>
        matchesCardMessage(row)
          ? { ...row, clozeState: saved.clozeState ?? null, clozeVersion: saved.clozeVersion }
          : row,
      );
      const updatedMessage = nextMessages.find(matchesCardMessage);
      segmentCacheRef.current.delete(card.id);
      setMessages(nextMessages);
      if (updatedMessage) {
        const nextCorrectTokenIndexes = Array.from(new Set([...card.correctTokenIndexes, ...correct])).sort((a, b) => a - b);
        setCards((current) =>
          current.map((row) =>
            row.id === card.id
              ? { ...row, message: updatedMessage, correctTokenIndexes: nextCorrectTokenIndexes }
              : row,
          ),
        );
      }
      if (updatedMessage) await persistPracticeMessageUpdate(card.contactId, updatedMessage);
      setAnswers((current) => {
        const next = { ...current };
        correct.forEach((tokenIndex) => delete next[tokenIndex]);
        return next;
      });
      setIsFlipped(false);
    }, t("practice.session.processing"));
  }

  async function discardCurrentCard(): Promise<void> {
    if (!card || isFlipping || cardMotionLocked.current) return;
    stopPracticeTts();
    // Pro 用户右滑丢弃必须以云端成功为准；非 Pro 只写本地，不产生云端交互。
    await runWithLoading(async () => {
      const isPro = await hasLocalProAccess();
      if (isPro && !card.message.id) {
        throw new Error("Missing cloud message id");
      }
      const result = isPro
        ? await discardMessageClozePractice({ messageId: card.message.id! })
        : { messageId: card.message.localId, clozePracticeDiscardedAt: new Date().toISOString() };
      const matchesCardMessage = (row: ChatMessage) =>
        (card.message.id && row.id === card.message.id) || row.localId === card.message.localId;
      const nextMessages = messages.map((row) =>
        matchesCardMessage(row)
          ? { ...row, clozePracticeDiscardedAt: result.clozePracticeDiscardedAt }
          : row,
      );
      const updatedMessage = nextMessages.find(matchesCardMessage);
      const nextCards = rebuildSessionCards(nextMessages);
      setMessages(nextMessages);
      setCards(nextCards);
      if (updatedMessage) await persistPracticeMessageUpdate(card.contactId, updatedMessage);
      setAnswers({});
      setIsFlipped(false);
      if (index >= nextCards.length) setIndex(Math.max(0, nextCards.length - 1));
    }, t("practice.session.processing")).catch(() => {
      setDialog({ message: t("practice.session.discard_failed") });
    });
  }

  if (!card) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.headerButton} onPress={onBack}><Ionicons name="chevron-back" size={26} color="#111111" /></Pressable>
          <Text style={styles.headerTitle}>{t("practice.session.title")}</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t("practice.session.completed")}</Text>
          <Pressable style={styles.doneButton} onPress={onBack}><Text style={styles.doneText}>{t("practice.session.back")}</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={askExit}><Ionicons name="chevron-back" size={26} color="#111111" /></Pressable>
        <Text style={styles.headerTitle}>{t("practice.session.title")}</Text>
        <Pressable style={styles.headerButton} onPress={() => setRulesOpen((value) => !value)}>
          <Ionicons name="help-circle-outline" size={22} color="#111111" />
        </Pressable>
      </View>

      {rulesOpen ? (
        <View style={styles.rulesLayer} pointerEvents="box-none">
          <Pressable style={styles.rulesBackdrop} onPress={() => setRulesOpen(false)} />
          <View style={styles.rulesPanel}>
            <Text style={styles.ruleText}>{t("practice.session.rule.next")}</Text>
            <Text style={styles.ruleText}>{t("practice.session.rule.prev")}</Text>
            <Text style={styles.ruleText}>{t("practice.session.rule.discard")}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.deck}>
        <Animated.View style={[styles.cardShell, { transform: translate.getTranslateTransform() }]} {...panResponder.panHandlers}>
            <View style={styles.cardShadow}>
              <Animated.View
                pointerEvents={isFlipping || isFlipped ? "none" : "auto"}
                style={[
                  styles.cardFace,
                  styles.cardFrontFace,
                  {
                    transform: [{ perspective: 900 }, { rotateY: frontRotateY }],
                  },
                ]}
              >
                <View style={styles.englishPane} onLayout={handleCardPaneLayout}>
                  <ScrollView
                    ref={englishScrollRef}
                    contentContainerStyle={[
                      styles.englishContent,
                      keyboardScrollPadding > 0 && { paddingBottom: 20 + keyboardScrollPadding },
                    ]}
                    bounces={false}
                    overScrollMode="never"
                    scrollEventThrottle={16}
                    onScroll={handleCardScroll}
                    onContentSizeChange={(_, height) => updateScrollState({ contentHeight: height })}
                    onTouchStart={handleCardScrollTouchStart}
                    onTouchMove={handleCardScrollTouchMove}
                    onTouchEnd={handleCardScrollTouchEnd}
                    onTouchCancel={handleCardScrollTouchEnd}
                  >
                    <PracticeEnglish
                      card={card}
                      segments={getCardSegments(card)}
                      answers={answers}
                      checkedAnswers={checkedAnswers}
                      onChangeAnswer={(tokenIndex, value) => setAnswers((prev) => ({ ...prev, [tokenIndex]: value }))}
                      onBlankFocus={handleBlankFocus}
                      onPlaySentence={(range) => {
                        if (!canUseTts) return;
                        sentenceTtsControllerRef.current?.abort();
                        const controller = new AbortController();
                        sentenceTtsControllerRef.current = controller;
                        void playPracticeSentence(card, range, {
                          signal: controller.signal,
                          shouldPlay: () => practiceMountedRef.current && sentenceTtsControllerRef.current === controller,
                        }).finally(() => {
                          if (sentenceTtsControllerRef.current === controller) {
                            sentenceTtsControllerRef.current = null;
                          }
                        });
                      }}
                    />
                  </ScrollView>
                </View>
              </Animated.View>

              {canFlipCard ? (
                <Animated.View
                  pointerEvents={isFlipping || !isFlipped ? "none" : "auto"}
                  style={[
                    styles.cardFace,
                    styles.cardBackFace,
                    {
                      transform: [{ perspective: 900 }, { rotateY: backRotateY }],
                    },
                  ]}
                >
                  <View style={styles.translationPane} onLayout={handleCardPaneLayout}>
                    <ScrollView
                      contentContainerStyle={styles.translationContent}
                      bounces={false}
                      overScrollMode="never"
                      scrollEventThrottle={16}
                      onScroll={handleCardScroll}
                      onContentSizeChange={(_, height) => updateScrollState({ contentHeight: height })}
                      onTouchStart={handleCardScrollTouchStart}
                      onTouchMove={handleCardScrollTouchMove}
                      onTouchEnd={handleCardScrollTouchEnd}
                      onTouchCancel={handleCardScrollTouchEnd}
                    >
                      <Text style={styles.translationText}>{card.translation}</Text>
                    </ScrollView>
                  </View>
                </Animated.View>
              ) : null}
            </View>
        </Animated.View>
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{index + 1}/{cards.length}</Text>
      </View>

      <View style={styles.sessionActionRow}>
        {canUseTts ? (
          <TtsPlayButton
            messageId={card.message.id ?? card.message.serverId}
            textStart={card.textStart}
            textEnd={card.textEnd}
            size={18}
            style={styles.roundActionButton}
          />
        ) : null}
        {canFlipCard ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isFlipped ? t("practice.session.flip_to_expression") : t("practice.session.flip_to_note")}
            style={[isFlipping && styles.flipButtonDisabled, styles.roundActionButton]}
            onPress={toggleFlip}
            disabled={isFlipping}
          >
            <Ionicons name="sync-outline" size={20} color="#111111" />
          </Pressable>
        ) : null}
      </View>

      <Pressable style={styles.checkButton} onPress={() => void checkAnswers()}>
        <Text style={styles.checkText}>{t("practice.session.check")}</Text>
      </Pressable>

      <BlockingLoading visible={!!loadingOptions} options={loadingOptions} />
      <InfoDialog config={dialog} onClose={() => setDialog(null)} />
    </SafeAreaView>
  );
}

async function playPracticeSentence(
  card: PracticeCard,
  range: { textStart: number; textEnd: number },
  options?: {
    signal?: AbortSignal;
    shouldPlay?: () => boolean;
  }
): Promise<void> {
  const messageId = card.message.id ?? card.message.serverId;
  if (!messageId) return;
  try {
    const asset = await getMessageTtsAsset({
      messageId,
      sourceKey: "rewrite",
      textStart: range.textStart,
      textEnd: range.textEnd,
      signal: options?.signal,
    });
    if (options?.signal?.aborted || options?.shouldPlay?.() === false) return;
    await playTtsAudio({
      url: asset.audioUrl,
      cacheKey: buildTtsCacheKey(asset),
      playbackRange: asset.playbackRange ?? undefined,
    });
  } catch (error) {
    if (options?.signal?.aborted || options?.shouldPlay?.() === false) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    Alert.alert(t("tts.error.title"), toFriendlyTtsErrorMessage(normalized));
  }
}

function toFriendlyTtsErrorMessage(error: Error & { code?: string; status?: number }): string {
  if (error.code === "PRO_REQUIRED" || error.status === 403) return t("tts.error.pro_required");
  return t("tts.error.failed");
}

function buildTtsCacheKey(asset: {
  id: string;
  voiceCode: string;
  languageCode: string;
  sourceKey: string;
  sourceTextHash: string;
}): string {
  return [
    asset.id,
    asset.voiceCode,
    asset.languageCode,
    asset.sourceKey,
    asset.sourceTextHash,
  ].join("-");
}

async function persistPracticeMessageUpdate(contactId: string, message: ChatMessage): Promise<void> {
  const dateKey = getMessageDateKey(message);
  const rows = await loadChatMessagesByDate(contactId, dateKey);
  const next = rows.map((row) =>
    (message.id && row.id === message.id) || row.localId === message.localId ? message : row,
  );
  await replaceChatMessagesByDate(contactId, dateKey, next);
  markChatDateDirty(contactId, dateKey);
  markPracticeStatsDirty(dateKey);
}

function PracticeEnglish({
  card,
  segments,
  answers,
  checkedAnswers,
  onChangeAnswer,
  onBlankFocus,
  onPlaySentence,
}: {
  card: PracticeCard;
  segments: PracticeEnglishSegment[];
  answers: Record<number, string>;
  checkedAnswers: Record<number, "correct" | "incorrect">;
  onChangeAnswer: (tokenIndex: number, value: string) => void;
  onBlankFocus: (inputRef: TextInput | null) => void;
  onPlaySentence: (range: { textStart: number; textEnd: number }) => void;
}) {
  const sentenceRows = useMemo(() => groupPracticeEnglishSentences(card, segments), [card, segments]);

  function renderSegment(segment: PracticeEnglishSegment, row: PracticeSentenceRow): React.ReactNode {
    if (segment.type === "blank") {
      const checked = checkedAnswers[segment.tokenIndex];
      const isCorrect = checked === "correct";
      const isIncorrect = checked === "incorrect";
      const answer = answers[segment.tokenIndex] ?? "";
      return (
        <React.Fragment key={segment.key}>
          {segment.spacer ? <Text style={segment.spacerHighlighted ? styles.phraseText : styles.englishText}> </Text> : null}
          {isCorrect ? (
            <Text style={[styles.tokenText, styles.correctText]}>{answer || segment.expectedText}</Text>
          ) : isIncorrect ? (
            <Text style={[styles.tokenText, styles.phraseText, styles.incorrectAnswerText]}>{segment.expectedText}</Text>
          ) : (
            <PracticeBlankInput
              segment={segment}
              answer={answer}
              onChangeAnswer={onChangeAnswer}
              onFocus={onBlankFocus}
            />
          )}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment key={segment.key}>
        {segment.spacer ? <Text style={segment.spacerHighlighted ? styles.phraseText : styles.englishText}> </Text> : null}
        <Text
          style={[styles.tokenText, segment.highlighted && styles.phraseText, segment.correct && styles.correctText]}
          onPress={() => onPlaySentence({ textStart: row.textStart, textEnd: row.textEnd })}
        >
          {segment.text}
        </Text>
      </React.Fragment>
    );
  }

  return (
    <View style={styles.englishSentences}>
      {sentenceRows.map((row) => (
        <View key={row.key} style={styles.englishSentenceRow}>
          <View style={styles.englishFlow}>
            {row.segments.map((segment) => renderSegment(segment, row))}
          </View>
        </View>
      ))}
    </View>
  );
}

function PracticeBlankInput({
  segment,
  answer,
  onChangeAnswer,
  onFocus,
}: {
  segment: Extract<PracticeEnglishSegment, { type: "blank" }>;
  answer: string;
  onChangeAnswer: (tokenIndex: number, value: string) => void;
  onFocus: (inputRef: TextInput | null) => void;
}) {
  const inputRef = useRef<TextInput | null>(null);

  return (
    <TextInput
      ref={inputRef}
      style={[
        styles.blankInput,
        { width: segment.width },
      ]}
      value={answer}
      onFocus={() => onFocus(inputRef.current)}
      onChangeText={(value) => onChangeAnswer(segment.tokenIndex, value)}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },

  header: {
    height: 64,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "400",
  },
  rulesLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  rulesBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  rulesPanel: {
    position: "absolute",
    top: 86,
    right: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E4EC",
    backgroundColor: "#FFFFFF",
    gap: 8,
    shadowColor: "#111111",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ruleText: {
    color: "#303541",
    fontSize: 13,
    lineHeight: 18,
  },

  deck: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  cardShell: {
    width: "100%",
    height: "100%",
  },
  cardShadow: {
    flex: 1,
    borderRadius: 18,
  },
  cardFace: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    overflow: "hidden",
    backfaceVisibility: "hidden",
  },
  cardFrontFace: {
    backgroundColor: "#FFFFFF",
  },
  cardBackFace: {
    backgroundColor: "#FFFDF8",
  },

  englishPane: {
    flex: 1,
  },
  englishContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    justifyContent: "flex-start",
  },
  englishText: {
    color: "#080808",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
    includeFontPadding: false,
  },
  englishSentences: {
    gap: 6,
  },
  englishSentenceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  englishFlow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  tokenText: {
    color: "#080808",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
    includeFontPadding: false,
  },
  phraseText: {
    backgroundColor: "#FFF2B8",
    color: "#080808",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
    includeFontPadding: false,
  },
  correctText: {
    color: "#6FAE78",
  },
  incorrectInput: {
    color: "#D64545",
    borderBottomColor: "#D64545",
    fontWeight: "500",
  },
  incorrectAnswerText: {
    color: "#D64545",
    fontWeight: "500",
  },
  blankInput: {
    height: 24,
    marginHorizontal: 0,
    paddingHorizontal: 1,
    paddingVertical: 0,
    backgroundColor: "#FFF2B8",
    borderBottomWidth: 1,
    borderBottomColor: "#111111",
    color: "#111111",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "400",
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },

  translationPane: {
    flex: 1,
    backgroundColor: "#FFFDF8",
  },
  translationContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    justifyContent: "flex-start",
  },
  translationText: {
    color: "#111111",
    fontSize: 16,
    lineHeight: 25,
    fontWeight: "400",
  },
  progressText: {
    marginTop: 0,
    color: "#8A90A0",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  progressRow: {
    minHeight: 18,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  sessionActionRow: {
    minHeight: 40,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  roundActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  flipButtonDisabled: {
    opacity: 0.7,
  },
  checkButton: {
    height: 48,
    marginHorizontal: 38,
    marginTop: 6,
    marginBottom: 14,
    borderRadius: 20,
    backgroundColor: "#EAE6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "500",
  },

  empty: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: "#111111",
    fontSize: 18,
  },
  doneButton: {
    marginTop: 18,
    height: 46,
    paddingHorizontal: 26,
    borderRadius: 18,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
