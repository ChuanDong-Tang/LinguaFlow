import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { TabBar } from "./shared/TabBar";

type MainScreenProps = {
  onOpenChat: () => void;
  onOpenMe: () => void;
};

export function MainScreen({ onOpenChat, onOpenMe }: MainScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>OIO</Text>
          <Ionicons name="sparkles-outline" size={19} color="#A99BFF" />
        </View>

        <Pressable style={styles.conversationRow} onPress={onOpenChat}>
          <View style={styles.avatarCircle}>
            <MaterialCommunityIcons name="ghost" size={36} color="#111111" />
          </View>

          <View style={styles.conversationBody}>
            <Text style={styles.conversationTitle}>好奇输入助手</Text>
            <Text style={styles.conversationSubtitle}>把中文想法，说成自然英文</Text>
          </View>

          <View style={styles.conversationMeta}>
            <Text style={styles.time}>09:41</Text>
            <Ionicons name="chevron-forward" size={23} color="#8C8F97" />
          </View>
        </Pressable>

        <View style={styles.divider} />

        <View style={styles.emptyArea}>
          <View style={styles.illustration}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={54}
              color="#A99BFF"
              style={styles.bubbleIcon}
            />
            <View style={styles.ghostLargeWrap}>
              <MaterialCommunityIcons name="ghost" size={96} color="#111111" />
              <Ionicons name="sparkles-outline" size={18} color="#A99BFF" style={styles.sparkIcon} />
            </View>
          </View>
          <Text style={styles.emptyText}>想到什么，就从一句话开始</Text>
        </View>
      </View>

      <TabBar activeTab="chat" onPressChat={onOpenChat} onPressMe={onOpenMe} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    flex: 1,
    paddingHorizontal: 22,
  },
  brandRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brand: {
    color: "#090909",
    fontSize: 25,
    fontWeight: "500",
  },
  conversationRow: {
    marginTop: 58,
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
  },
  avatarCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  conversationBody: {
    flex: 1,
    marginLeft: 18,
    paddingRight: 12,
  },
  conversationTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
  },
  conversationSubtitle: {
    marginTop: 6,
    color: "#7E8491",
    fontSize: 15,
    lineHeight: 21,
  },
  conversationMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  time: {
    color: "#8B8F97",
    fontSize: 15,
  },
  divider: {
    marginTop: 28,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  emptyArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 92,
  },
  illustration: {
    width: 190,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleIcon: {
    position: "absolute",
    left: 8,
    top: 20,
  },
  ghostLargeWrap: {
    position: "absolute",
    right: 18,
    top: 34,
    width: 126,
    height: 126,
    alignItems: "center",
    justifyContent: "center",
  },
  sparkIcon: {
    position: "absolute",
    right: 4,
    top: -2,
  },
  emptyText: {
    marginTop: 14,
    color: "#C3C6CE",
    fontSize: 14,
  },
});
