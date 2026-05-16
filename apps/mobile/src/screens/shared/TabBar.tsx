import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type TabBarProps = {
  activeTab: "chat" | "practice" | "me";
  onPressChat: () => void;
  onPressPractice: () => void;
  onPressMe: () => void;
};

export function TabBar({ activeTab, onPressChat, onPressPractice, onPressMe }: TabBarProps) {
  return (
    <View style={styles.bar}>
      <Pressable style={styles.tab} onPress={activeTab === "chat" ? undefined : onPressChat}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={26}
          color={activeTab === "chat" ? "#111111" : "#8D919B"}
        />
        <Text style={[styles.label, activeTab === "chat" && styles.labelActive]}>对话</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "practice" ? undefined : onPressPractice}>
        <View style={[styles.practiceIconWrap, activeTab === "practice" && styles.practiceIconWrapActive]}>
          <Ionicons
            name="list-outline"
            size={25}
            color={activeTab === "practice" ? "#6E63FF" : "#8D919B"}
          />
        </View>
        <Text style={[styles.label, activeTab === "practice" && styles.labelActivePractice]}>练习</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "me" ? undefined : onPressMe}>
        <Ionicons
          name="person-outline"
          size={25}
          color={activeTab === "me" ? "#6E63FF" : "#8D919B"}
        />
        <Text style={[styles.label, activeTab === "me" && styles.labelActiveMe]}>我</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 86,
    borderTopWidth: 1,
    borderTopColor: "#E6E8ED",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingBottom: 8,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 96,
  },
  label: {
    marginTop: 4,
    fontSize: 13,
    color: "#8D919B",
  },
  labelActive: {
    color: "#111111",
    fontWeight: "600",
  },
  labelActivePractice: {
    color: "#6E63FF",
    fontWeight: "600",
  },
  labelActiveMe: {
    color: "#6E63FF",
    fontWeight: "600",
  },
  practiceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  practiceIconWrapActive: {
    backgroundColor: "#EEEAFE",
  },
});
