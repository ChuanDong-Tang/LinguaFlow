import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type TabBarProps = {
  activeTab: "main" | "practice" | "me";
  onPressMain: () => void;
  onPressPractice: () => void;
  onPressMe: () => void;
};

export function TabBar({ activeTab, onPressMain, onPressPractice, onPressMe }: TabBarProps) {
  return (
    <View style={styles.bar}>
      <Pressable style={styles.tab} onPress={activeTab === "main" ? undefined : onPressMain}>
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={24}
          color={activeTab === "main" ? "#746BFF" : "#9AA0AB"}
        />
        <Text style={[styles.label, activeTab === "main" && styles.labelActive]}>对话</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "practice" ? undefined : onPressPractice}>
        <View style={styles.practiceIconWrap}>
          <Ionicons
            name="list-outline"
            size={24}
            color={activeTab === "practice" ? "#746BFF" : "#9AA0AB"}
          />
        </View>
        <Text style={[styles.label, activeTab === "practice" && styles.labelActive]}>练习</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "me" ? undefined : onPressMe}>
        <Ionicons
          name="person-outline"
          size={24}
          color={activeTab === "me" ? "#746BFF" : "#9AA0AB"}
        />
        <Text style={[styles.label, activeTab === "me" && styles.labelActive]}>我</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 86,
    borderTopWidth: 1,
    borderTopColor: "#E7E5DF",
    backgroundColor: "#FFFEFB",
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
    fontSize: 12,
    color: "#9AA0AB",
  },
  labelActive: {
    color: "#746BFF",
    fontWeight: "500",
  },
  practiceIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
