import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "./types";

type MessageListProps = {
  messages: ChatMessage[];
  selectedDateLabel: string;
  scrollRef: React.RefObject<ScrollView | null>;
  isLoadingHistory: boolean;
  isLoadingOlder: boolean;
  isLoadingNewer: boolean;
  onReachTop: () => void;
  onReachBottom: () => void;
  onRetryMessage: (message: ChatMessage) => void;
};

export function MessageList({
  messages,
  selectedDateLabel,
  scrollRef,
  isLoadingHistory,
  isLoadingOlder,
  isLoadingNewer,
  onReachTop,
  onReachBottom,
  onRetryMessage,
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
      <Text style={styles.dayText}>{selectedDateLabel}</Text>

      {isLoadingOlder ? <ActivityIndicator style={styles.indicator} size="small" color="#9AA0AB" /> : null}
      {isLoadingHistory ? <ActivityIndicator style={styles.indicator} size="small" color="#9AA0AB" /> : null}

      {messages.map((m, i) =>
        m.role === "user" ? (
          <View key={`u-${i}`} style={styles.userBlock}>
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{m.text}</Text>
            </View>
            <Text style={styles.timeTextRight}>{m.time}</Text>
          </View>
        ) : (
          <View key={`a-${i}`} style={styles.assistantBlock}>
            <View style={styles.assistantAvatar} />
            <View style={styles.assistantCard}>
              <Text style={styles.assistantCardText}>{m.text || "..."}</Text>
              <View style={styles.cardActionRow}>
                {m.status === "failed" && (m.retryCount ?? 0) < 1 && m.retryText ? (
                  <Pressable style={styles.retryButton} onPress={() => onRetryMessage(m)}>
                    <Text style={styles.retryText}>重试</Text>
                  </Pressable>
                ) : (
                  <View style={styles.voiceBtn}>
                    <Text style={styles.voiceIcon}>⋮⋮</Text>
                  </View>
                )}
                <Text style={styles.copyIcon}>▢</Text>
              </View>
            </View>
            <Text style={styles.timeTextLeft}>{m.time}</Text>
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
    paddingTop: 16,
    paddingBottom: 24,
  },
  dayText: {
    textAlign: "center",
    color: "#9AA0AB",
    fontSize: 14,
    marginBottom: 18,
  },
  indicator: {
    marginBottom: 10,
  },
  indicatorBottom: {
    marginTop: 8,
  },
  userBlock: {
    alignItems: "flex-end",
    marginBottom: 14,
  },
  userBubble: {
    backgroundColor: "#F1EEFF",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
    maxWidth: "82%",
  },
  userText: {
    color: "#111111",
    fontSize: 18,
    lineHeight: 26,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#D6D4FA",
    marginBottom: 8,
  },
  assistantCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ECEEF2",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 18,
    marginLeft: 26,
  },
  assistantCardText: {
    color: "#111111",
    fontSize: 20,
    lineHeight: 30,
  },
  cardActionRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  voiceBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#DDD9FF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F7FF",
  },
  voiceIcon: {
    fontSize: 14,
    color: "#6E6BFF",
    letterSpacing: 2,
    transform: [{ rotate: "90deg" }],
  },
  retryButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  copyIcon: {
    fontSize: 28,
    color: "#222222",
    marginRight: 4,
  },
  timeTextLeft: {
    marginTop: 8,
    marginLeft: 28,
    color: "#A1A7B2",
    fontSize: 12,
  },
});
