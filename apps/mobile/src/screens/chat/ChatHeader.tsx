import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type ChatHeaderProps = {
  onBack: () => void;
  onOpenCalendar: () => void;
  onOpenMenu: () => void;
};

export function ChatHeader({ onBack, onOpenCalendar, onOpenMenu }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
        <Ionicons name="chevron-back" size={28} color="#111111" />
      </Pressable>

      <View style={styles.headerAvatarWrap}>
        <Text style={styles.logoText}>OIO</Text>
      </View>

      <View style={styles.headerBody}>
        <Text style={styles.headerTitle}>好奇改写助手</Text>
        <Text style={styles.headerSubTitle}>帮你把话说得更自然，尤其是英文</Text>
      </View>

      <Pressable style={styles.calendarButton} hitSlop={8} onPress={onOpenCalendar}>
        <Ionicons name="calendar-outline" size={24} color="#111111" />
      </Pressable>

      <Pressable style={styles.menuButton} hitSlop={8} onPress={onOpenMenu}>
        <Ionicons name="ellipsis-horizontal" size={24} color="#111111" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 82,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarWrap: {
    marginLeft: 8,
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "#B5ACFF",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 15,
    color: "#5A5497",
    letterSpacing: 1,
  },
  headerBody: {
    marginLeft: 10,
    flex: 1,
    paddingRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111111",
  },
  headerSubTitle: {
    marginTop: 3,
    color: "#838AA0",
    fontSize: 12.5,
    lineHeight: 18,
  },
  calendarButton: {
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButton: {
    marginLeft: 6,
    width: 34,
    alignItems: "center",
    justifyContent: "center",
  },
});
