import React from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatMessage } from "../../domain/chat/types";
import type { ChatContact } from "../../domain/chat/contacts";
import type { AutoCopyMode } from "../../services/preferences/assistantPreferences";
import { getClozeBlankRanges, getClozeCorrectRanges, getClozeHighlightRanges, normalizeClozeState } from "../../domain/cloze/clozeUtils";
import { getAssistantClozeText } from "../../domain/cloze/clozeText";
import {
  SelectableMessageText,
  type NativeTextSelectionPayload,
  type SelectableMessageTextRef,
} from "./SelectableMessageText";

const TypingDots = React.memo(function TypingDots() {
  const dot1 = React.useRef(new Animated.Value(0.35)).current;
  const dot2 = React.useRef(new Animated.Value(0.35)).current;
  const dot3 = React.useRef(new Animated.Value(0.35)).current;

  React.useEffect(() => {
    const makeAnimation = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.35,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.delay(260),
        ])
      );

    const animations = [
      makeAnimation(dot1, 0),
      makeAnimation(dot2, 160),
      makeAnimation(dot3, 320),
    ];

    animations.forEach((animation) => animation.start());

    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.typingDots}>
      {[dot1, dot2, dot3].map((dot, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity: dot,
              transform: [{ scale: dot }],
            },
          ]}
        />
      ))}
    </View>
  );
});

type MessageListProps = {
  contact: ChatContact;
  messages: ChatMessage[];
  selectedDateLabel: string;
  listRef?: React.RefObject<FlatList<RowItem> | null>;
  onSelectionRefChange: (ref: SelectableMessageTextRef | null) => void;
  onScrollBeginDrag?: () => void;
  onScrollMetrics?: (metrics: { y: number; contentHeight: number; layoutHeight: number }) => void;
  onRetryMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage, mode: AutoCopyMode) => void;
  onTextSelection: (
    message: ChatMessage,
    payload: NativeTextSelectionPayload,
    clearSelection: () => void,
  ) => void;
  onEditClozeGroup: (message: ChatMessage, groupIndex: number) => void;
  onDeleteClozeGroup: (message: ChatMessage, groupIndex: number) => void;
};

type RowItem =
  | { kind: "header"; id: string }
  | { kind: "message"; id: string; message: ChatMessage };

const MESSAGE_LIST_PERF_LOGS = false;
const SLOW_MESSAGE_RENDER_MS = 12;
function getCopyOptions(contact: ChatContact): { label: string; mode: AutoCopyMode }[] {
  if (contact.id === "english_friend") {
    return [
      { label: "问题", mode: "en" },
      { label: "回复", mode: "zh" },
      { label: "全部", mode: "both" },
    ];
  }

  return [
    { label: "英文", mode: "en" },
    { label: "中文", mode: "zh" },
    { label: "全部", mode: "both" },
  ];
}

function perfNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function logMessageListPerf(label: string, startedAt: number, extra?: Record<string, unknown>): void {
  if (!MESSAGE_LIST_PERF_LOGS) return;
  const elapsedMs = perfNow() - startedAt;
  if (elapsedMs < SLOW_MESSAGE_RENDER_MS) return;
  const elapsed = elapsedMs.toFixed(1);
  if (extra) {
    console.log(`[message-list-perf] ${label}: ${elapsed}ms`, extra);
    return;
  }
  console.log(`[message-list-perf] ${label}: ${elapsed}ms`);
}

function useLatestRef<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

const DayHeader = React.memo(function DayHeader({ selectedDateLabel }: { selectedDateLabel: string }) {
  return (
    <View style={styles.dayDivider}>
      <View style={styles.dayLine} />
      <Text style={styles.dayText}>{selectedDateLabel}</Text>
      <View style={styles.dayLine} />
    </View>
  );
});

const UserMessageRow = React.memo(function UserMessageRow({
  message,
  onSelectionRefChange,
}: {
  message: ChatMessage;
  onSelectionRefChange: (ref: SelectableMessageTextRef | null) => void;
}) {
  const renderStart = perfNow();
  const selectableRef = React.useRef<SelectableMessageTextRef | null>(null);
  const textLength = message.text.length;
  React.useEffect(() => {
    logMessageListPerf("user row render+commit", renderStart, {
      localId: message.localId,
      textLength,
    });
  });

  return (
    <View style={styles.userBlock}>
      <View style={styles.userBubble}>
        <SelectableMessageText
          ref={selectableRef}
          text={message.text}
          style={styles.userText}
          enableClozeMenu={false}
          onSelectionStart={() => onSelectionRefChange(selectableRef.current)}
        />
      </View>
      <Text style={styles.timeTextRight}>{message.time}</Text>
    </View>
  );
});

const AssistantMessageRow = React.memo(function AssistantMessageRow({
  message,
  contact,
  onSelectionRefChange,
  onRetryMessage,
  onCopyMessage,
  onTextSelection,
  onEditClozeGroup,
  onDeleteClozeGroup,
}: {
  message: ChatMessage;
  contact: ChatContact;
  onSelectionRefChange: (ref: SelectableMessageTextRef | null) => void;
  onRetryMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage, mode: AutoCopyMode) => void;
  onTextSelection: (
    message: ChatMessage,
    payload: NativeTextSelectionPayload,
    clearSelection: () => void,
  ) => void;
  onEditClozeGroup: (message: ChatMessage, groupIndex: number) => void;
  onDeleteClozeGroup: (message: ChatMessage, groupIndex: number) => void;
}) {
  const renderStart = perfNow();
  const selectableRef = React.useRef<SelectableMessageTextRef | null>(null);
  const [answersVisible, setAnswersVisible] = React.useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = React.useState(false);
  const copyOptions = React.useMemo(() => getCopyOptions(contact), [contact]);
  const clozeText = React.useMemo(() => {
    const startedAt = perfNow();
    const value = getAssistantClozeText(message, contact);
    logMessageListPerf("assistant get cloze text", startedAt, {
      localId: message.localId,
      textLength: message.text.length,
    });
    return value;
  }, [contact, message]);

  const displayText = clozeText.text;
  const hasDisplayText = displayText.trim().length > 0;

  const assistantRenderState:
    | "typing"
    | "streaming"
    | "complete"
    | "failed"
    | "empty" =
    message.status === "pending" && !hasDisplayText
      ? "typing"
      : message.status === "pending" && hasDisplayText
        ? "streaming"
        : message.status === "success" && hasDisplayText
          ? "complete"
          : message.status === "failed"
            ? "failed"
            : "empty";

  const shouldShowActions =
    assistantRenderState === "complete" || assistantRenderState === "failed";

  const shouldShowTime =
    assistantRenderState === "complete" || assistantRenderState === "failed";

  const shouldShowTranslation =
    assistantRenderState === "complete" && !!clozeText.translation;

  const shouldShowAiBadge =
    hasDisplayText &&
    (assistantRenderState === "streaming" ||
      assistantRenderState === "complete" ||
      assistantRenderState === "failed");

  const canShowCloze = assistantRenderState === "complete";

  const clozeState = React.useMemo(() => {
    const startedAt = perfNow();
    const value = normalizeClozeState(message.clozeState);
    logMessageListPerf("assistant normalize cloze state", startedAt, {
      localId: message.localId,
      groups: value?.groups.length ?? 0,
    });
    return value;
  }, [message.clozeState, message.localId]);
  const hasClozeGroup = canShowCloze && !!clozeState?.groups.length;
  const hasBlank = canShowCloze && !!clozeState?.groups.some((group) => group.blankTokenIndexes.length > 0);
  const highlightRanges = React.useMemo(
    () => {
      const startedAt = perfNow();
      const value = hasClozeGroup ? getClozeHighlightRanges(displayText, clozeState) : undefined;
      logMessageListPerf("assistant highlight ranges", startedAt, {
        localId: message.localId,
        textLength: displayText.length,
        ranges: value?.length ?? 0,
      });
      return value;
    },
    [clozeState, displayText, hasClozeGroup, message.localId],
  );
  const blankRanges = React.useMemo(
    () => {
      const startedAt = perfNow();
      const value = hasBlank ? getClozeBlankRanges(displayText, clozeState, answersVisible) : undefined;
      logMessageListPerf("assistant blank ranges", startedAt, {
        localId: message.localId,
        textLength: displayText.length,
        ranges: value?.length ?? 0,
        answersVisible,
      });
      return value;
    },
    [answersVisible, clozeState, displayText, hasBlank, message.localId],
  );
  const correctRanges = React.useMemo(
    () => {
      const startedAt = perfNow();
      const value = hasBlank ? getClozeCorrectRanges(displayText, clozeState) : undefined;
      logMessageListPerf("assistant correct ranges", startedAt, {
        localId: message.localId,
        textLength: displayText.length,
        ranges: value?.length ?? 0,
      });
      return value;
    },
    [clozeState, displayText, hasBlank, message.localId],
  );

  React.useEffect(() => {
    logMessageListPerf("assistant row render+commit", renderStart, {
      localId: message.localId,
      textLength: displayText.length,
      hasClozeGroup,
      hasBlank,
    });
  });

  return (
    <View style={styles.assistantBlock}>
      <View style={styles.assistantRow}>
        <View style={styles.assistantAvatar}>
          <Text style={styles.assistantLogo}>OIO</Text>
        </View>
        <View style={styles.assistantCard}>
          {assistantRenderState === "typing" ? (
            <TypingDots />
          ) : hasDisplayText ? (
            <SelectableMessageText
              ref={selectableRef}
              text={displayText}
              style={styles.assistantCardText}
              highlightRanges={highlightRanges}
              blankRanges={blankRanges}
              correctRanges={correctRanges}
              trailingElement={
                shouldShowAiBadge && !shouldShowTranslation ? (
                  <Text style={styles.inlineAiBadge}> (AI生成) </Text>
                ) : undefined
              }
              onSelectionStart={
                canShowCloze
                  ? () => onSelectionRefChange(selectableRef.current)
                  : undefined
              }
              onSelectionChange={
                canShowCloze
                  ? (payload) => {
                    onSelectionRefChange(selectableRef.current);
                    onTextSelection(message, payload, () => selectableRef.current?.clearSelection());
                  }
                  : undefined
              }
              onClozeRangePress={
                hasClozeGroup ? (groupIndex) => onEditClozeGroup(message, groupIndex) : undefined
              }
              onClozeRangeLongPress={
                hasClozeGroup ? (groupIndex) => onDeleteClozeGroup(message, groupIndex) : undefined
              }
            />
          ) : null}
          {shouldShowTranslation ? (
            <Text style={styles.translationText}>
              {clozeText.translation}
              {shouldShowAiBadge ? <Text style={styles.inlineAiBadge}> (AI生成) </Text> : null}
            </Text>
          ) : null}
          {shouldShowActions ? (
            <View style={styles.cardActionRow}>
              {message.status === "failed" && (message.retryCount ?? 0) < 1 && message.retryText ? (
                <Pressable style={styles.retryButton} onPress={() => onRetryMessage(message)}>
                  <Text style={styles.retryText}>重试</Text>
                </Pressable>
              ) : hasBlank ? (
                <Pressable style={styles.eyeButton} hitSlop={8} onPress={() => setAnswersVisible((value) => !value)}>
                  <Ionicons name={answersVisible ? "eye-off-outline" : "eye-outline"} size={22} color="#111111" />
                </Pressable>
              ) : (
                <View />
              )}

              <View style={styles.copyControl}>
                {isCopyMenuOpen ? (
                  <View style={styles.copyMenu}>
                    {copyOptions.map((option) => (
                      <Pressable
                        key={option.mode}
                        style={styles.copyMenuOption}
                        hitSlop={4}
                        onPress={() => {
                          setIsCopyMenuOpen(false);
                          onCopyMessage(message, option.mode);
                        }}
                      >
                        <Text style={styles.copyMenuText}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  style={styles.copyButton}
                  hitSlop={8}
                  onPress={() => setIsCopyMenuOpen((value) => !value)}
                  disabled={!message.text.trim()}
                >
                  <Ionicons name="copy-outline" size={22} color={!message.text.trim() ? "#C1C5CE" : "#111111"} />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </View>
      {shouldShowTime ? (
        <Text style={styles.timeTextLeft}>{message.time}</Text>
      ) : null}
    </View>
  );
});

export function MessageList({
  messages,
  contact,
  selectedDateLabel,
  listRef,
  onSelectionRefChange,
  onScrollBeginDrag,
  onScrollMetrics,
  onRetryMessage,
  onCopyMessage,
  onTextSelection,
  onEditClozeGroup,
  onDeleteClozeGroup,
}: MessageListProps) {
  const renderStart = perfNow();
  const retryMessageRef = useLatestRef(onRetryMessage);
  const copyMessageRef = useLatestRef(onCopyMessage);
  const textSelectionRef = useLatestRef(onTextSelection);
  const editClozeGroupRef = useLatestRef(onEditClozeGroup);
  const deleteClozeGroupRef = useLatestRef(onDeleteClozeGroup);
  const rows = React.useMemo<RowItem[]>(() => {
    const startedAt = perfNow();
    const items: RowItem[] = [{ kind: "header", id: "header" }];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      items.push({ kind: "message", id: String(message.id ?? message.localId), message });
    }
    logMessageListPerf("build rows", startedAt, { messages: messages.length, rows: items.length });
    return items;
  }, [messages]);

  React.useEffect(() => {
    logMessageListPerf("list render+commit", renderStart, { messages: messages.length, rows: rows.length });
  });

  const keyExtractor = React.useCallback((item: RowItem) => item.id, []);
  const handleSelectionRefChange = React.useCallback((ref: SelectableMessageTextRef | null) => {
    onSelectionRefChange(ref);
  }, [onSelectionRefChange]);
  const handleRetryMessage = React.useCallback((message: ChatMessage) => {
    retryMessageRef.current(message);
  }, [retryMessageRef]);
  const handleCopyMessage = React.useCallback((message: ChatMessage, mode: AutoCopyMode) => {
    copyMessageRef.current(message, mode);
  }, [copyMessageRef]);
  const handleTextSelection = React.useCallback(
    (message: ChatMessage, payload: NativeTextSelectionPayload, clearSelection: () => void) => {
      textSelectionRef.current(message, payload, clearSelection);
    },
    [textSelectionRef],
  );
  const handleEditClozeGroup = React.useCallback(
    (message: ChatMessage, groupIndex: number) => {
      editClozeGroupRef.current(message, groupIndex);
    },
    [editClozeGroupRef],
  );
  const handleDeleteClozeGroup = React.useCallback(
    (message: ChatMessage, groupIndex: number) => {
      deleteClozeGroupRef.current(message, groupIndex);
    },
    [deleteClozeGroupRef],
  );

  const renderItem = React.useCallback(
    ({ item }: { item: RowItem }) => {
      if (item.kind === "header") {
        return <DayHeader selectedDateLabel={selectedDateLabel} />;
      }
      const message = item.message;
      if (message.role === "user") {
        return (
          <UserMessageRow
            message={message}
            onSelectionRefChange={handleSelectionRefChange}
          />
        );
      }
      return (
        <AssistantMessageRow
          message={message}
          contact={contact}
          onSelectionRefChange={handleSelectionRefChange}
          onRetryMessage={handleRetryMessage}
          onCopyMessage={handleCopyMessage}
          onTextSelection={handleTextSelection}
          onEditClozeGroup={handleEditClozeGroup}
          onDeleteClozeGroup={handleDeleteClozeGroup}
        />
      );
    },
    [
      contact,
      handleCopyMessage,
      handleDeleteClozeGroup,
      handleEditClozeGroup,
      handleSelectionRefChange,
      handleRetryMessage,
      handleTextSelection,
      selectedDateLabel,
    ]
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.messageList}
      contentContainerStyle={styles.messageListContent}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      windowSize={9}
      initialNumToRender={16}
      maxToRenderPerBatch={16}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={onScrollBeginDrag}
      onScroll={(e) => {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        onScrollMetrics?.({
          y: contentOffset.y,
          contentHeight: contentSize.height,
          layoutHeight: layoutMeasurement.height,
        });
      }}
    />
  );
}

const styles = StyleSheet.create({
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  dayDivider: {
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dayLine: {
    width: 76,
    height: 1,
    backgroundColor: "#E7E8EE",
  },
  dayText: {
    marginHorizontal: 12,
    color: "#8F95A1",
    fontSize: 13,
  },
  userBlock: {
    alignItems: "flex-end",
    marginBottom: 18,
  },
  userBubble: {
    backgroundColor: "#EFECFD",
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 16,
    maxWidth: "78%",
  },
  userText: {
    color: "#111111",
    fontSize: 17,
    lineHeight: 24,
  },
  timeTextRight: {
    marginTop: 8,
    marginRight: 4,
    color: "#9CA2B3",
    fontSize: 13,
  },
  assistantBlock: {
    marginBottom: 18,
  },
  assistantRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  assistantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#B5ACFF",
    marginTop: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantLogo: {
    color: "#5A5497",
    fontSize: 12,
    letterSpacing: 0,
  },
  assistantCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#DBDFE7",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    marginLeft: 10,
  },
  assistantCardText: {
    color: "#111111",
    fontSize: 17,
    lineHeight: 23,
  },
  inlineAiBadge: {
    color: "#6A62B7",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 16,
  },
  translationText: {
    marginTop: 12,
    color: "#727988",
    fontSize: 14,
    lineHeight: 21,
  },
  cardActionRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  retryButton: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  copyButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  copyControl: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  copyMenu: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 6,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DBDFE7",
    backgroundColor: "#F7F8FB",
  },
  copyMenuOption: {
    height: 24,
    minWidth: 34,
    paddingHorizontal: 7,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copyMenuText: {
    color: "#111111",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0,
  },
  eyeButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  timeTextLeft: {
    marginTop: 8,
    marginLeft: 50,
    color: "#9CA2B3",
    fontSize: 13,
  },
  typingDots: {
    height: 25,
    flexDirection: "row",
    alignItems: "center",
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#8F95A1",
    marginRight: 6,
  },
});
