import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

type ChatHeaderProps = {
  onBack: () => void;
  onOpenCalendar: () => void;
  onOpenMenu: () => void;
};

export function ChatHeader({ onBack, onOpenCalendar, onOpenMenu }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
        <Ionicons name="chevron-back" size={26} color="#111111" />
      </Pressable>

      <View style={styles.headerAvatarWrap}>
        <MaterialCommunityIcons name="ghost" size={28} color="#111111" />
      </View>

      <View style={styles.headerBody}>
        <Text style={styles.headerTitle}>好奇改写助手</Text>
        <Text style={styles.headerSubTitle}>帮你把话说得更自然，尤其是英文</Text>
      </View>

      <Pressable style={styles.calendarButton} hitSlop={8} onPress={onOpenCalendar}>
        <Ionicons name="calendar-outline" size={26} color="#111111" />
      </Pressable>

      <Pressable style={styles.menuButton} hitSlop={8} onPress={onOpenMenu}>
        <Ionicons name="ellipsis-horizontal" size={25} color="#111111" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  headerBody: {
    marginLeft: 10,
    flex: 1,
    paddingRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111111",
  },
  headerSubTitle: {
    marginTop: 4,
    color: "#9AA0AB",
    fontSize: 12.5,
    lineHeight: 17,
  },
  calendarButton: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButton: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
