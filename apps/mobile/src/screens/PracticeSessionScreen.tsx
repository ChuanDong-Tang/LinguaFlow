import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import { markChatDateDirty, markPracticeStatsDirty } from "../services/chat/chatPracticeSyncState";

type PracticeSessionScreenProps = {
  initialCards: PracticeCard[];
  allMessages: ChatMessage[];
  onBack: () => void;
};

type PracticeEnglishSegment =
  | { type: "text"; key: string; text: string; highlighted: boolean; correct: boolean }
  | { type: "blank"; key: string; tokenIndex: number; width: number; spacer: boolean; expectedText: string };

const EDGE_SWITCH_COMMIT_THRESHOLD = 5;
const DISCARD_SWIPE_RATIO = 0.15;
const TOUCH_AXIS_LOCK_THRESHOLD = 8;
const PRACTICE_SCROLL_EDGE_DEBUG = true;

function logPracticeScrollEdge(label: string, extra?: Record<string, unknown>): void {
  if (!PRACTICE_SCROLL_EDGE_DEBUG) return;
  if (extra) {
    console.log(`[practice-scroll-edge] ${label}`, extra);
    return;
  }
  console.log(`[practice-scroll-edge] ${label}`);
}

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
    if (isBlank) {
      return {
        type: "blank",
        key: `blank-${token.index}`,
        tokenIndex: token.index,
        width: Math.max(36, token.text.length * 10),
        spacer,
        expectedText: token.text,
      };
    }
    return {
      type: "text",
      key: `text-${token.index}`,
      text: `${spacer ? " " : ""}${token.text}`,
      highlighted: isPhrase || isAnsweredBlank,
      correct: isAnsweredBlank,
    };
  });
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
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const flipAnim = useRef(new Animated.Value(0)).current;
  const cardMotionLocked = useRef(false);
  const segmentCacheRef = useRef(new Map<string, PracticeEnglishSegment[]>());
  const gestureAxis = useRef<"x" | null>(null);
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

  const getCardSegments = (target: PracticeCard): PracticeEnglishSegment[] => {
    const cached = segmentCacheRef.current.get(target.id);
    if (cached) return cached;
    const segments = buildPracticeEnglishSegments(target);
    segmentCacheRef.current.set(target.id, segments);
    return segments;
  };

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
        onTimeout: () => setDialog({ message: "处理超时，请稍后重试。" }),
      },
    );
  }

  function askExit(): void {
    setDialog({
      message: "是否真的退出这次练习？",
      cancelText: "取消",
      confirmText: "确定",
      onConfirm: onBack,
    });
  }

  function askDiscardCurrentCard(): void {
    setDialog({
      message: "是否丢弃这张卡片？丢弃后不会再进入练习。",
      cancelText: "取消",
      confirmText: "丢弃",
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
    const current = scrollStateRef.current;
    if (
      Math.abs(previous.contentHeight - current.contentHeight) > 1 ||
      Math.abs(previous.layoutHeight - current.layoutHeight) > 1 ||
      Math.abs(previous.maxY - current.maxY) > 1
    ) {
      logPracticeScrollEdge("metrics", {
        y: current.y.toFixed(1),
        contentHeight: current.contentHeight.toFixed(1),
        layoutHeight: current.layoutHeight.toFixed(1),
        maxY: current.maxY.toFixed(1),
      });
    }
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
    const direction = (() => {
      if (maxY <= 1) {
        if (dy < 0 && index < cards.length - 1) return "next";
        if (dy > 0 && index > 0) return "prev";
        return null;
      }
      if (dy < 0 && y >= maxY - 1 && index < cards.length - 1) return "next";
      if (dy > 0 && y <= 1 && index > 0) return "prev";
      return null;
    })();
    logPracticeScrollEdge("edge check", {
      dy: dy.toFixed(1),
      direction,
      index,
      cards: cards.length,
      y: y.toFixed(1),
      maxY: maxY.toFixed(1),
      atTop: y <= 1,
      atBottom: maxY <= 1 || y >= maxY - 1,
    });
    return direction;
  }

  function handleCardScrollTouchStart(event: NativeSyntheticEvent<any>): void {
    scrollEdgeDragRef.current = {
      startX: event.nativeEvent.pageX,
      startY: event.nativeEvent.pageY,
      axis: null,
      direction: null,
      distance: 0,
    };
    const { y, maxY, contentHeight, layoutHeight } = scrollStateRef.current;
    logPracticeScrollEdge("touch start", {
      pageY: event.nativeEvent.pageY.toFixed(1),
      index,
      y: y.toFixed(1),
      contentHeight: contentHeight.toFixed(1),
      layoutHeight: layoutHeight.toFixed(1),
      maxY: maxY.toFixed(1),
      atTop: y <= 1,
      atBottom: maxY <= 1 || y >= maxY - 1,
    });
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
      const nextCards = buildPracticeCards(nextMessages);
      segmentCacheRef.current.delete(card.id);
      setMessages(nextMessages);
      setCards(nextCards);
      if (updatedMessage) await persistPracticeMessageUpdate(card.contactId, updatedMessage);
      setAnswers((current) => {
        const next = { ...current };
        correct.forEach((tokenIndex) => delete next[tokenIndex]);
        return next;
      });
      setIsFlipped(false);
      if (index >= nextCards.length) setIndex(Math.max(0, nextCards.length - 1));
    }, "正在处理...");
  }

  async function discardCurrentCard(): Promise<void> {
    if (!card || isFlipping || cardMotionLocked.current) return;
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
      const nextCards = buildPracticeCards(nextMessages);
      setMessages(nextMessages);
      setCards(nextCards);
      if (updatedMessage) await persistPracticeMessageUpdate(card.contactId, updatedMessage);
      setAnswers({});
      setIsFlipped(false);
      if (index >= nextCards.length) setIndex(Math.max(0, nextCards.length - 1));
    }, "正在处理...").catch(() => {
      setDialog({ message: "丢弃失败，请稍后重试。" });
    });
  }

  if (!card) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.headerButton} onPress={onBack}><Ionicons name="chevron-back" size={26} color="#111111" /></Pressable>
          <Text style={styles.headerTitle}>卡片练习</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>这组练习已经完成。</Text>
          <Pressable style={styles.doneButton} onPress={onBack}><Text style={styles.doneText}>返回</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={askExit}><Ionicons name="chevron-back" size={26} color="#111111" /></Pressable>
        <Text style={styles.headerTitle}>卡片练习</Text>
        <Pressable style={styles.headerButton} onPress={() => setRulesOpen((value) => !value)}>
          <Ionicons name="help-circle-outline" size={22} color="#111111" />
        </Pressable>
      </View>

      {rulesOpen ? (
        <View style={styles.rulesLayer} pointerEvents="box-none">
          <Pressable style={styles.rulesBackdrop} onPress={() => setRulesOpen(false)} />
          <View style={styles.rulesPanel}>
            <Text style={styles.ruleText}>上滑：下一张</Text>
            <Text style={styles.ruleText}>下滑：上一张</Text>
            <Text style={styles.ruleText}>右滑：丢弃此卡片</Text>
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
                    contentContainerStyle={styles.englishContent}
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
                      segments={getCardSegments(card)}
                      answers={answers}
                      checkedAnswers={checkedAnswers}
                      onChangeAnswer={(tokenIndex, value) => setAnswers((prev) => ({ ...prev, [tokenIndex]: value }))}
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

      {canFlipCard ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFlipped ? "翻到英文" : "翻到中文"}
          style={[isFlipping && styles.flipButtonDisabled, styles.flipButton]}
          onPress={toggleFlip}
          disabled={isFlipping}
        >
          <Ionicons name="sync-outline" size={20} color="#111111" />
        </Pressable>
      ) : null}

      <Pressable style={styles.checkButton} onPress={() => void checkAnswers()}>
        <Text style={styles.checkText}>检查</Text>
      </Pressable>

      <BlockingLoading visible={!!loadingOptions} options={loadingOptions} />
      <InfoDialog config={dialog} onClose={() => setDialog(null)} />
    </SafeAreaView>
  );
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
  segments,
  answers,
  checkedAnswers,
  onChangeAnswer,
}: {
  segments: PracticeEnglishSegment[];
  answers: Record<number, string>;
  checkedAnswers: Record<number, "correct" | "incorrect">;
  onChangeAnswer: (tokenIndex: number, value: string) => void;
}) {
  return (
    <View style={styles.englishFlow}>
      {segments.map((segment) => {
        if (segment.type === "blank") {
          const checked = checkedAnswers[segment.tokenIndex];
          const isCorrect = checked === "correct";
          const isIncorrect = checked === "incorrect";
          return (
            <React.Fragment key={segment.key}>
              {segment.spacer ? <Text style={styles.englishText}> </Text> : null}
              {isCorrect ? (
                <Text style={[styles.tokenText, styles.correctText]}>{answers[segment.tokenIndex] || segment.expectedText}</Text>
              ) : (
                <TextInput
                  style={[
                    styles.blankInput,
                    isIncorrect && styles.incorrectInput,
                    { width: segment.width },
                  ]}
                  value={answers[segment.tokenIndex] ?? ""}
                  onChangeText={(value) => onChangeAnswer(segment.tokenIndex, value)}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
            </React.Fragment>
          );
        }
        return (
          <Text key={segment.key} style={[styles.tokenText, segment.highlighted && styles.phraseText, segment.correct && styles.correctText]}>
            {segment.text}
          </Text>
        );
      })}
    </View>
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
  },
  englishFlow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
  },
  tokenText: {
    color: "#080808",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  phraseText: {
    backgroundColor: "#FFF2B8",
    color: "#080808",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  correctText: {
    color: "#6FAE78",
  },
  incorrectInput: {
    color: "#D77A7A",
    borderBottomColor: "#D77A7A",
  },
  blankInput: {
    height: 24,
    marginHorizontal: 2,
    paddingHorizontal: 1,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#111111",
    color: "#111111",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "400",
    textAlign: "center",
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
  flipButton: {
    alignSelf: "center",
    width: 40,
    height: 40,
    marginTop: 4,
    borderRadius: 20,
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
