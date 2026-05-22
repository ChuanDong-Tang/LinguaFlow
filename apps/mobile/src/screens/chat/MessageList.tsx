import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatMessage } from "../../domain/chat/types";
import type { ChatContact } from "../../domain/chat/contacts";
import { getClozeBlankRanges, getClozeHighlightRanges, normalizeClozeState } from "../../domain/cloze/clozeUtils";
import { getAssistantClozeText } from "../../domain/cloze/clozeText";
import {
  SelectableMessageText,
  type NativeTextSelectionPayload,
  type SelectableMessageTextRef,
} from "./SelectableMessageText";

type MessageListProps = {
  contact: ChatContact;
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

const UserMessageRow = React.memo(function UserMessageRow({
  message,
  onBlankPress,
}: {
  message: ChatMessage;
  onBlankPress: () => void;
}) {
  return (
    <Pressable style={styles.userBlock} onPress={onBlankPress}>
      <Pressable style={styles.userBubble} onPress={() => undefined}>
        <Text style={styles.userText}>{message.text}</Text>
      </Pressable>
      <Text style={styles.timeTextRight}>{message.time}</Text>
    </Pressable>
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
  onBlankPress,
}: {
  message: ChatMessage;
  contact: ChatContact;
  onSelectionRefChange: (ref: SelectableMessageTextRef | null) => void;
  onBlankPress: () => void;
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
  const selectableRef = React.useRef<SelectableMessageTextRef | null>(null);
  const [answersVisible, setAnswersVisible] = React.useState(false);
  const clozeText = React.useMemo(() => getAssistantClozeText(message, contact), [contact, message]);
  const displayText = clozeText.text || "...";
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
    <Pressable style={styles.assistantBlock} onPress={onBlankPress}>
      <View style={styles.assistantRow}>
        <View style={styles.assistantAvatar}>
          <Text style={styles.assistantLogo}>OIO</Text>
        </View>
        <Pressable style={styles.assistantCard} onPress={() => undefined}>
          <SelectableMessageText
            ref={selectableRef}
            text={displayText}
            style={styles.assistantCardText}
            highlightRanges={highlightRanges}
            blankRanges={blankRanges}
            onSelectionStart={() => onSelectionRefChange(selectableRef.current)}
            onSelectionChange={(payload) => {
              onSelectionRefChange(selectableRef.current);
              onTextSelection(message, payload, () => selectableRef.current?.clearSelection());
            }}
            onClozeRangePress={hasClozeGroup ? (groupIndex) => onEditClozeGroup(message, groupIndex) : undefined}
            onClozeRangeLongPress={hasClozeGroup ? (groupIndex) => onDeleteClozeGroup(message, groupIndex) : undefined}
          />
          {clozeText.translation ? <Text style={styles.translationText}>{clozeText.translation}</Text> : null}
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
        </Pressable>
      </View>
      <Text style={styles.timeTextLeft}>{message.time}</Text>
    </Pressable>
  );
});

export function MessageList({
  messages,
  contact,
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
  const activeSelectionRef = React.useRef<SelectableMessageTextRef | null>(null);
  const rows = React.useMemo<RowItem[]>(() => {
    const items: RowItem[] = [{ kind: "header", id: "header" }];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      items.push({ kind: "message", id: String(message.id ?? message.localId), message });
    }
    return items;
  }, [messages]);

  const keyExtractor = React.useCallback((item: RowItem) => item.id, []);
  const clearActiveSelection = React.useCallback(() => {
    activeSelectionRef.current?.clearSelection();
    activeSelectionRef.current = null;
  }, []);
  const handleSelectionRefChange = React.useCallback((ref: SelectableMessageTextRef | null) => {
    activeSelectionRef.current = ref;
  }, []);

  const renderItem = React.useCallback(
    ({ item }: { item: RowItem }) => {
      if (item.kind === "header") {
        return <DayHeader selectedDateLabel={selectedDateLabel} />;
      }
      const message = item.message;
      if (message.role === "user") {
        return <UserMessageRow message={message} onBlankPress={clearActiveSelection} />;
      }
      return (
        <AssistantMessageRow
          message={message}
          contact={contact}
          onSelectionRefChange={handleSelectionRefChange}
          onBlankPress={clearActiveSelection}
          onRetryMessage={onRetryMessage}
          onCopyMessage={onCopyMessage}
          onTextSelection={onTextSelection}
          onEditClozeGroup={onEditClozeGroup}
          onDeleteClozeGroup={onDeleteClozeGroup}
        />
      );
    },
    [
      contact,
      clearActiveSelection,
      handleSelectionRefChange,
      onCopyMessage,
      onDeleteClozeGroup,
      onEditClozeGroup,
      onRetryMessage,
      onTextSelection,
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
      ListFooterComponent={<Pressable style={styles.blankTapArea} onPress={clearActiveSelection} />}
      windowSize={9}
      initialNumToRender={16}
      maxToRenderPerBatch={16}
      updateCellsBatchingPeriod={50}
      removeClippedSubviews
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={() => {
        clearActiveSelection();
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
  blankTapArea: {
    height: 24,
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
    marginLeft: 50,
    color: "#9CA2B3",
    fontSize: 13,
  },
});
