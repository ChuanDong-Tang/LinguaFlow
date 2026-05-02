import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type ChatHeaderProps = {
  onBack: () => void;
  onOpenCalendar: () => void;
};

export function ChatHeader({ onBack, onOpenCalendar }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>

      <View style={styles.headerAvatarWrap}>
        <View style={styles.headerAvatar} />
      </View>

      <View style={styles.headerBody}>
        <Text style={styles.headerTitle}>好奇改写助手</Text>
        <Text style={styles.headerSubTitle}>帮你把话说得更自然，尤其是英文</Text>
      </View>

      <Pressable style={styles.calendarButton} hitSlop={8} onPress={onOpenCalendar}>
        <Text style={styles.calendarText}>📅</Text>
      </Pressable>

      <Pressable style={styles.moreButton} hitSlop={8}>
        <Text style={styles.moreText}>•••</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 86,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  backText: {
    fontSize: 42,
    color: "#111111",
    lineHeight: 42,
  },
  headerAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#ECEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#D6D4FA",
  },
  headerBody: {
    marginLeft: 10,
    flex: 1,
    paddingRight: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111111",
  },
  headerSubTitle: {
    marginTop: 4,
    color: "#9AA0AB",
    fontSize: 13,
    lineHeight: 18,
  },
  calendarButton: {
    width: 30,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  calendarText: {
    color: "#111111",
    fontSize: 20,
    lineHeight: 22,
  },
  moreButton: {
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: {
    fontSize: 20,
    color: "#111111",
    letterSpacing: 1,
  },
});
