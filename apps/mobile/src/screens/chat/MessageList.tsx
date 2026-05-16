import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatMessage } from "../../domain/chat/types";
import { getClozeBlankRanges, getClozeHighlightRanges, normalizeClozeState } from "../../domain/cloze/clozeUtils";
import { SelectableMessageText, type NativeTextSelectionPayload } from "./SelectableMessageText";
import { parseTaggedRewrite } from "../../domain/rewrite/taggedRewrite";

type MessageListProps = {
  messages: ChatMessage[];
  selectedDateLabel: string;
  listRef?: React.RefObject<FlatList<RowItem> | null>;
  onScrollBeginDrag?: () => void;
  onScrollMetrics?: (metrics: { y: number; contentHeight: number; layoutHeight: number }) => void;
  onRetryMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage) => void;
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

const DayHeader = React.memo(function DayHeader({ selectedDateLabel }: { selectedDateLabel: string }) {
  return (
    <View style={styles.dayDivider}>
      <View style={styles.dayLine} />
      <Text style={styles.dayText}>{selectedDateLabel}</Text>
      <View style={styles.dayLine} />
    </View>
  );
});

const UserMessageRow = React.memo(function UserMessageRow({ message }: { message: ChatMessage }) {
  return (
    <View style={styles.userBlock}>
      <View style={styles.userBubble}>
        <Text selectable selectionColor="#8E7BFF" style={styles.userText}>
          {message.text}
        </Text>
      </View>
      <Text style={styles.timeTextRight}>{message.time}</Text>
    </View>
  );
});

const AssistantMessageRow = React.memo(function AssistantMessageRow({
  message,
  onRetryMessage,
  onCopyMessage,
  onTextSelection,
  onEditClozeGroup,
  onDeleteClozeGroup,
}: {
  message: ChatMessage;
  onRetryMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage) => void;
  onTextSelection: (
    message: ChatMessage,
    payload: NativeTextSelectionPayload,
    clearSelection: () => void,
  ) => void;
  onEditClozeGroup: (message: ChatMessage, groupIndex: number) => void;
  onDeleteClozeGroup: (message: ChatMessage, groupIndex: number) => void;
}) {
  const selectableRef = React.useRef<{ clearSelection: () => void } | null>(null);
  const [answersVisible, setAnswersVisible] = React.useState(false);
  const tagged = React.useMemo(() => parseTaggedRewrite(message.text), [message.text]);
  const displayText = tagged.en || "...";
  const clozeState = React.useMemo(() => normalizeClozeState(message.clozeState), [message.clozeState]);
  const hasClozeGroup = !!clozeState?.groups.length;
  const hasBlank = !!clozeState?.groups.some((group) => group.blankTokenIndexes.length > 0);
  const highlightRanges = React.useMemo(
    () => (hasClozeGroup ? getClozeHighlightRanges(displayText, clozeState) : undefined),
    [clozeState, displayText, hasClozeGroup],
  );
  const blankRanges = React.useMemo(
    () => (hasBlank ? getClozeBlankRanges(displayText, clozeState, answersVisible) : undefined),
    [answersVisible, clozeState, displayText, hasBlank],
  );

  return (
    <View style={styles.assistantBlock}>
      <View style={styles.assistantRow}>
        <View style={styles.assistantAvatar}>
          <Text style={styles.assistantLogo}>OIO</Text>
        </View>
        <View style={styles.assistantCard}>
          <SelectableMessageText
            ref={selectableRef}
            text={displayText}
            style={styles.assistantCardText}
            highlightRanges={highlightRanges}
            blankRanges={blankRanges}
            onSelectionChange={(payload) => {
              onTextSelection(message, payload, () => selectableRef.current?.clearSelection());
            }}
            onClozeRangePress={hasClozeGroup ? (groupIndex) => onEditClozeGroup(message, groupIndex) : undefined}
            onClozeRangeLongPress={hasClozeGroup ? (groupIndex) => onDeleteClozeGroup(message, groupIndex) : undefined}
          />
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
            <Pressable
              style={styles.copyButton}
              hitSlop={8}
              onPress={() => onCopyMessage(message)}
              disabled={!message.text.trim()}
            >
              <Ionicons name="copy-outline" size={22} color={!message.text.trim() ? "#C1C5CE" : "#111111"} />
            </Pressable>
          </View>
          {tagged.zh ? <Text style={styles.translationText}>{tagged.zh}</Text> : null}
        </View>
      </View>
      <Text style={styles.timeTextLeft}>{message.time}</Text>
    </View>
  );
});

export function MessageList({
  messages,
  selectedDateLabel,
  listRef,
  onScrollBeginDrag,
  onScrollMetrics,
  onRetryMessage,
  onCopyMessage,
  onTextSelection,
  onEditClozeGroup,
  onDeleteClozeGroup,
}: MessageListProps) {
  const rows = React.useMemo<RowItem[]>(() => {
    const items: RowItem[] = [{ kind: "header", id: "header" }];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      items.push({ kind: "message", id: String(message.id ?? message.localId), message });
    }
    return items;
  }, [messages]);

  const keyExtractor = React.useCallback((item: RowItem) => item.id, []);

  const renderItem = React.useCallback(
    ({ item }: { item: RowItem }) => {
      if (item.kind === "header") {
        return <DayHeader selectedDateLabel={selectedDateLabel} />;
      }
      const message = item.message;
      if (message.role === "user") {
        return <UserMessageRow message={message} />;
      }
      return (
        <AssistantMessageRow
          message={message}
          onRetryMessage={onRetryMessage}
          onCopyMessage={onCopyMessage}
          onTextSelection={onTextSelection}
          onEditClozeGroup={onEditClozeGroup}
          onDeleteClozeGroup={onDeleteClozeGroup}
        />
      );
    },
    [onCopyMessage, onDeleteClozeGroup, onEditClozeGroup, onRetryMessage, onTextSelection, selectedDateLabel]
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
      onScrollBeginDrag={() => {
        onScrollBeginDrag?.();
      }}
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
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#B5ACFF",
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantLogo: {
    color: "#5A5497",
    fontSize: 15,
    letterSpacing: 1,
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
    marginLeft: 14,
  },
  assistantCardText: {
    color: "#111111",
    fontSize: 17,
    lineHeight: 25,
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
  eyeButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  timeTextLeft: {
    marginTop: 8,
    marginLeft: 66,
    color: "#9CA2B3",
    fontSize: 13,
  },
});
