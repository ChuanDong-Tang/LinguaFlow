import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ChatMessage } from "./types";

type MessageListProps = {
  messages: ChatMessage[];
  selectedDateLabel: string;
  scrollRef: React.RefObject<ScrollView | null>;
  isLoadingHistory: boolean;
  showCenterLoading: boolean;
  isLoadingOlder: boolean;
  isLoadingNewer: boolean;
  onReachTop: () => void;
  onReachBottom: () => void;
  onRetryMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage) => void;
};

export function MessageList({
  messages,
  selectedDateLabel,
  scrollRef,
  isLoadingHistory,
  showCenterLoading,
  isLoadingOlder,
  isLoadingNewer,
  onReachTop,
  onReachBottom,
  onRetryMessage,
  onCopyMessage,
}: MessageListProps) {
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.messageList}
      contentContainerStyle={styles.messageListContent}
      scrollEventThrottle={16}
      onScroll={(e) => {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        const y = contentOffset.y;
        if (y < -36) onReachTop();
        const distanceToBottom = contentSize.height - (y + layoutMeasurement.height);
        if (distanceToBottom < 36) onReachBottom();
      }}
    >
      <View style={styles.dayDivider}>
        <View style={styles.dayLine} />
        <Text style={styles.dayText}>{selectedDateLabel}</Text>
        <View style={styles.dayLine} />
      </View>

      {isLoadingOlder ? <ActivityIndicator style={styles.indicator} size="small" color="#9AA0AB" /> : null}
      {isLoadingHistory ? <ActivityIndicator style={styles.indicator} size="small" color="#9AA0AB" /> : null}
      {showCenterLoading ? (
        <View style={styles.centerLoadingWrap}>
          <View style={styles.skeletonCard} />
          <ActivityIndicator size="small" color="#7F8795" />
        </View>
      ) : null}

      {messages.map((message, index) =>
        message.role === "user" ? (
          <View key={`u-${index}`} style={styles.userBlock}>
            <View style={styles.userBubble}>
              <Text selectable selectionColor="#8E7BFF" style={styles.userText}>
                {message.text}
              </Text>
            </View>
            <Text style={styles.timeTextRight}>{message.time}</Text>
          </View>
        ) : (
          <View key={`a-${index}`} style={styles.assistantBlock}>
            <View style={styles.assistantAvatar}>
              <MaterialCommunityIcons name="ghost" size={23} color="#111111" />
            </View>
            <View style={styles.assistantCard}>
              <Text selectable selectionColor="#8E7BFF" style={styles.assistantCardText}>
                {message.text || "..."}
              </Text>
              <View style={styles.cardActionRow}>
                {message.status === "failed" && (message.retryCount ?? 0) < 1 && message.retryText ? (
                  <Pressable style={styles.retryButton} onPress={() => onRetryMessage(message)}>
                    <Text style={styles.retryText}>重试</Text>
                  </Pressable>
                ) : <View />}
                <Pressable
                  style={styles.copyButton}
                  hitSlop={8}
                  onPress={() => onCopyMessage(message)}
                  disabled={!message.text.trim()}
                >
                  <Ionicons
                    name="copy-outline"
                    size={21}
                    color={!message.text.trim() ? "#C1C5CE" : "#111111"}
                  />
                </Pressable>
              </View>
            </View>
            <Text style={styles.timeTextLeft}>{message.time}</Text>
          </View>
        )
      )}

      {isLoadingNewer ? <ActivityIndicator style={styles.indicatorBottom} size="small" color="#9AA0AB" /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 18,
  },
  dayDivider: {
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dayLine: {
    width: 42,
    height: 1,
    backgroundColor: "#E7E8EE",
  },
  dayText: {
    marginHorizontal: 12,
    color: "#8F95A1",
    fontSize: 13,
  },
  indicator: {
    marginBottom: 10,
  },
  indicatorBottom: {
    marginTop: 8,
  },
  centerLoadingWrap: {
    marginVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  skeletonCard: {
    width: "72%",
    height: 54,
    borderRadius: 14,
    backgroundColor: "#F1F3F7",
    borderWidth: 1,
    borderColor: "#E7EAF0",
  },
  userBlock: {
    alignItems: "flex-end",
    marginBottom: 14,
  },
  userBubble: {
    backgroundColor: "#EDE9FF",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    color: "#A1A7B2",
    fontSize: 12,
  },
  assistantBlock: {
    marginBottom: 14,
  },
  assistantAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F0ECFF",
    marginBottom: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E8E9EE",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    marginLeft: 18,
    shadowColor: "#111111",
    shadowOpacity: 0.04,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  assistantCardText: {
    color: "#111111",
    fontSize: 17,
    lineHeight: 26,
  },
  cardActionRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  retryButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
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
  timeTextLeft: {
    marginTop: 8,
    marginLeft: 58,
    color: "#A1A7B2",
    fontSize: 12,
  },
});
