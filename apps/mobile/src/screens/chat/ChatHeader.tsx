import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatContact } from "../../domain/chat/contacts";

type ChatHeaderProps = {
  contact: ChatContact;
  onBack: () => void;
  onOpenCalendar: () => void;
  onOpenMenu: () => void;
};

export function ChatHeader({ contact, onBack, onOpenCalendar, onOpenMenu }: ChatHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
        <Ionicons name="chevron-back" size={24} color="#111111" />
      </Pressable>

      <View style={styles.headerAvatarWrap}>
        <Text style={styles.logoText}>{contact.avatarLabel}</Text>
      </View>

      <View style={styles.headerBody}>
        <Text style={styles.headerTitle}>{contact.name}</Text>
        <Text style={styles.headerSubTitle}>{contact.description}</Text>
      </View>

      <Pressable style={styles.calendarButton} hitSlop={8} onPress={onOpenCalendar}>
        <Ionicons name="calendar-outline" size={22} color="#111111" />
      </Pressable>

      <Pressable style={styles.menuButton} hitSlop={8} onPress={onOpenMenu}>
        <Ionicons name="ellipsis-horizontal" size={22} color="#111111" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingTop: 4,
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
    marginLeft: 6,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#B5ACFF",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 12,
    color: "#5A5497",
    letterSpacing: 0,
  },
  headerBody: {
    marginLeft: 9,
    flex: 1,
    paddingRight: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111111",
  },
  headerSubTitle: {
    marginTop: 2,
    color: "#838AA0",
    fontSize: 11.5,
    lineHeight: 16,
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
