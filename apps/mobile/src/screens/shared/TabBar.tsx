import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type TabBarProps = {
  activeTab: "chat" | "me";
  onPressChat: () => void;
  onPressMe: () => void;
};

export function TabBar({ activeTab, onPressChat, onPressMe }: TabBarProps) {
  return (
    <View style={styles.bar}>
      <Pressable style={styles.tab} onPress={activeTab === "chat" ? undefined : onPressChat}>
        <Ionicons
          name={activeTab === "chat" ? "chatbubble-ellipses" : "chatbubble-ellipses-outline"}
          size={25}
          color={activeTab === "chat" ? "#111111" : "#9A9FAA"}
        />
        <Text style={[styles.label, activeTab === "chat" && styles.labelActive]}>对话</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "me" ? undefined : onPressMe}>
        <Ionicons
          name={activeTab === "me" ? "person" : "person-outline"}
          size={25}
          color={activeTab === "me" ? "#111111" : "#9A9FAA"}
        />
        <Text style={[styles.label, activeTab === "me" && styles.labelActive]}>我</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 82,
    borderTopWidth: 1,
    borderTopColor: "#ECEEF2",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingBottom: 8,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
  },
  label: {
    marginTop: 4,
    fontSize: 13,
    color: "#8F95A1",
  },
  labelActive: {
    color: "#111111",
  },
});
