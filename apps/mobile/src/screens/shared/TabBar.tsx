import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { t } from "../../i18n";

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
        <View style={styles.iconSlot}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={24}
            color={activeTab === "main" ? "#746BFF" : "#9AA0AB"}
          />
        </View>
        <Text style={[styles.label, activeTab === "main" && styles.labelActive]}>{t("tabs.chat")}</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "practice" ? undefined : onPressPractice}>
        <View style={styles.iconSlot}>
          <Ionicons
            name="list-outline"
            size={24}
            color={activeTab === "practice" ? "#746BFF" : "#9AA0AB"}
          />
        </View>
        <Text style={[styles.label, activeTab === "practice" && styles.labelActive]}>{t("tabs.practice")}</Text>
      </Pressable>

      <Pressable style={styles.tab} onPress={activeTab === "me" ? undefined : onPressMe}>
        <View style={styles.iconSlot}>
          <Ionicons
            name="person-outline"
            size={24}
            color={activeTab === "me" ? "#746BFF" : "#9AA0AB"}
          />
        </View>
        <Text style={[styles.label, activeTab === "me" && styles.labelActive]}>{t("tabs.me")}</Text>
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
    height: 16,
    lineHeight: 16,
    fontSize: 12,
    color: "#9AA0AB",
  },
  labelActive: {
    color: "#746BFF",
  },
  iconSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
