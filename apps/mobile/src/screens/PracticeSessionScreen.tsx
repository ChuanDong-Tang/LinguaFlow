import React, { useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
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
import { tokenizeForCloze } from "../domain/cloze/clozeUtils";
import { BlockingLoading, type BlockingLoadingOptions, runWithDeferredBlockingLoading } from "./shared/BlockingLoading";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import {
  applyCorrectAnswers,
  buildPracticeCards,
  getBlankAnswers,
  type PracticeCard,
} from "../domain/practice/practiceService";
import { discardMessageClozePractice, updateMessageClozeState } from "../services/api/chatHistoryApi";
import { replaceRewriteMessages } from "../services/chat/rewriteSessionService";
import { hasLocalProAccess } from "../services/entitlement/proAccess";

type PracticeSessionScreenProps = {
  initialCards: PracticeCard[];
  allMessages: ChatMessage[];
  onBack: () => void;
};

export function PracticeSessionScreen({ initialCards, allMessages, onBack }: PracticeSessionScreenProps) {
  const window = useWindowDimensions();
  const [cards, setCards] = useState(initialCards);
  const [messages, setMessages] = useState(allMessages);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [rulesOpen, setRulesOpen] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const gestureAxis = useRef<"x" | "y" | null>(null);
  const card = cards[index] ?? null;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8 || Math.abs(gesture.dx) > 8,
        onPanResponderGrant: () => {
          gestureAxis.current = null;
        },
        onPanResponderMove: (_, gesture) => {
          if (!gestureAxis.current) {
            gestureAxis.current = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? "x" : "y";
          }
          if (gestureAxis.current === "x") {
            translate.setValue({ x: Math.max(0, gesture.dx), y: 0 });
            return;
          }
          translate.setValue({ x: 0, y: gesture.dy });
        },
        onPanResponderRelease: (_, gesture) => {
          const verticalThreshold = Math.max(42, window.height * 0.07);
          const discardThreshold = window.width * 0.25;
          // 丢弃是写库动作：先回弹卡片，再等待云端确认，成功后才移除。
          if (gestureAxis.current === "x" && gesture.dx > discardThreshold) {
            Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
            gestureAxis.current = null;
            askDiscardCurrentCard();
            return;
          }
          if (gestureAxis.current === "y" && gesture.dy < -verticalThreshold) {
            goNext();
            return;
          }
          if (gestureAxis.current === "y" && gesture.dy > verticalThreshold) {
            goPrev();
            return;
          }
          Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
          gestureAxis.current = null;
        },
        onPanResponderTerminate: () => {
          gestureAxis.current = null;
          Animated.spring(translate, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start();
        },
      }),
    [index, cards.length, window.height, window.width],
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
    gestureAxis.current = null;
    translate.setValue({ x: 0, y: 0 });
  }

  function goNext(): void {
    if (index >= cards.length - 1) {
      resetMotion();
      return;
    }
    Animated.timing(translate, { toValue: { x: 0, y: -window.height }, duration: 180, useNativeDriver: true }).start(() => {
      setAnswers({});
      setIndex((value) => Math.min(cards.length - 1, value + 1));
      resetMotion();
    });
  }

  function goPrev(): void {
    if (index <= 0) {
      resetMotion();
      return;
    }
    Animated.timing(translate, { toValue: { x: 0, y: window.height }, duration: 180, useNativeDriver: true }).start(() => {
      setAnswers({});
      setIndex((value) => Math.max(0, value - 1));
      resetMotion();
    });
  }

  async function checkAnswers(): Promise<void> {
    if (!card) return;
    const answerMap = getBlankAnswers(card);
    const correct: number[] = [];
    for (const tokenIndex of card.blankTokenIndexes) {
      const expected = answerMap.get(tokenIndex)?.trim().toLowerCase();
      const actual = (answers[tokenIndex] ?? "").trim().toLowerCase();
      if (expected && actual === expected) correct.push(tokenIndex);
    }
    if (!correct.length) {
      const cleared = { ...answers };
      card.blankTokenIndexes.forEach((tokenIndex) => {
        cleared[tokenIndex] = "";
      });
      setAnswers(cleared);
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
      const nextCards = buildPracticeCards(nextMessages);
      setMessages(nextMessages);
      setCards(nextCards);
      await replaceRewriteMessages(nextMessages);
      setAnswers({});
      if (index >= nextCards.length) setIndex(Math.max(0, nextCards.length - 1));
    }, "正在处理...");
  }

  async function discardCurrentCard(): Promise<void> {
    if (!card) return;
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
      const nextCards = buildPracticeCards(nextMessages);
      setMessages(nextMessages);
      setCards(nextCards);
      await replaceRewriteMessages(nextMessages);
      setAnswers({});
      if (index >= nextCards.length) setIndex(Math.max(0, nextCards.length - 1));
    }, "正在处理...").catch(() => {
      setDialog({ message: "丢弃失败，请稍后重试。" });
    });
  }

  if (!card) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.headerButton} onPress={onBack}><Ionicons name="chevron-back" size={30} color="#111111" /></Pressable>
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
        <Pressable style={styles.headerButton} onPress={askExit}><Ionicons name="chevron-back" size={30} color="#111111" /></Pressable>
        <Text style={styles.headerTitle}>卡片练习</Text>
        <Pressable style={styles.headerButton} onPress={() => setRulesOpen((value) => !value)}>
          <Ionicons name="help-circle-outline" size={25} color="#111111" />
        </Pressable>
      </View>

      {rulesOpen ? (
        <View style={styles.rulesPanel}>
          <Text style={styles.ruleText}>上滑：下一张</Text>
          <Text style={styles.ruleText}>下滑：上一张</Text>
          <Text style={styles.ruleText}>右滑：丢弃此卡片</Text>
        </View>
      ) : null}

      <View style={styles.deck}>
        <Animated.View style={[styles.card, { transform: translate.getTranslateTransform() }]} {...panResponder.panHandlers}>
          <ScrollView style={styles.englishPane} contentContainerStyle={styles.englishContent}>
            <PracticeEnglish card={card} answers={answers} onChangeAnswer={(tokenIndex, value) => setAnswers((prev) => ({ ...prev, [tokenIndex]: value }))} />
          </ScrollView>
          <View style={styles.divider} />
          <ScrollView style={styles.translationPane} contentContainerStyle={styles.translationContent}>
            <Text style={styles.translationText}>{card.translation || " "}</Text>
          </ScrollView>
        </Animated.View>
      </View>

      <Text style={styles.progressText}>{index + 1}/{cards.length}</Text>

      <Pressable style={styles.checkButton} onPress={() => void checkAnswers()}>
        <Text style={styles.checkText}>检查</Text>
      </Pressable>

      <BlockingLoading visible={!!loadingOptions} options={loadingOptions} />
      <InfoDialog config={dialog} onClose={() => setDialog(null)} />
    </SafeAreaView>
  );
}

function PracticeEnglish({
  card,
  answers,
  onChangeAnswer,
}: {
  card: PracticeCard;
  answers: Record<number, string>;
  onChangeAnswer: (tokenIndex: number, value: string) => void;
}) {
  // card.text 已经是 <en></en> 中间的英文正文，所以这里的 token 索引可直接对应 clozeState。
  const tokens = tokenizeForCloze(card.text);
  const phraseSet = new Set(card.phraseTokenIndexes);
  const blankSet = new Set(card.blankTokenIndexes);
  const correctSet = new Set(card.correctTokenIndexes);
  return (
    <View style={styles.englishFlow}>
      {tokens.map((token, index) => {
        const isPhrase = phraseSet.has(token.index);
        const isAnsweredBlank = blankSet.has(token.index) && correctSet.has(token.index);
        const isBlank = blankSet.has(token.index) && !correctSet.has(token.index);
        const previous = tokens[index - 1];
        const spacer = previous && token.kind === "word" && previous.kind === "word" ? " " : "";
        if (isBlank) {
          return (
            <React.Fragment key={token.index}>
              {spacer ? <Text style={styles.englishText}> </Text> : null}
              <TextInput
                style={[styles.blankInput, { width: Math.max(36, token.text.length * 10) }]}
                value={answers[token.index] ?? ""}
                onChangeText={(value) => onChangeAnswer(token.index, value)}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </React.Fragment>
          );
        }
        return (
          <Text key={token.index} style={[styles.tokenText, (isPhrase || isAnsweredBlank) && styles.phraseText]}>
            {spacer}{token.text}
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
    height: 78,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#111111",
    fontSize: 24,
    fontWeight: "500",
  },
  rulesPanel: {
    position: "absolute",
    zIndex: 3,
    top: 93,
    right: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
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
    fontSize: 14,
    lineHeight: 20,
  },

  deck: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 52,
    paddingTop: 28,
    paddingBottom: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    height: "100%",
    maxHeight: 470,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#DDE1E8",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    shadowColor: "#111111",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  englishPane: {
    flex: 1.08,
    flexGrow: 1,
  },
  englishContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    justifyContent: "center",
  },
  englishText: {
    color: "#080808",
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "500",
  },
  englishFlow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
  },
  tokenText: {
    color: "#080808",
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "500",
  },
  phraseText: {
    backgroundColor: "#FFF2B8",
    color: "#080808",
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "500",
  },
  blankInput: {
    height: 25,
    marginHorizontal: 2,
    paddingHorizontal: 1,
    paddingVertical: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: "#111111",
    color: "#111111",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "500",
    textAlign: "center",
  },

  divider: {
    height: 1,
    backgroundColor: "#E1E3EA",
  },
  translationPane: {
    flex: 0.92,
    flexGrow: 1,
    backgroundColor: "#FFFDF9",
  },
  translationContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 18,
    justifyContent: "center",
  },
  translationText: {
    color: "#111111",
    fontSize: 14,
    lineHeight: 21,
  },

  progressText: {
    marginTop: 2,
    color: "#8A90A0",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  checkButton: {
    height: 54,
    marginHorizontal: 34,
    marginTop: 8,
    marginBottom: 18,
    borderRadius: 24,
    backgroundColor: "#EAE6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "600",
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
