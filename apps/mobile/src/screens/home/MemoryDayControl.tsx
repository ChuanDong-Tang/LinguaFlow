import React from "react";
import { Pressable, View } from "react-native";
import { Text } from "../../components/Typography";
import Ionicons from "@expo/vector-icons/Ionicons";
import { getLanguage } from "../../i18n";
import { theme } from "../../theme";
import { shiftMemoryDay } from "./memoryHome";

const labels = {
  "zh-CN": ["前一天", "后一天", "回到今天"],
  "zh-TW": ["前一天", "後一天", "回到今天"],
  "en-US": ["Previous day", "Next day", "Back to today"],
  "ja-JP": ["前の日", "次の日", "今日に戻る"],
};

export function MemoryDayControl({ day, today, onChange }: { day: string; today: string; onChange: (day: string | null) => void }) {
  const copy = labels[getLanguage() as keyof typeof labels] ?? labels["en-US"];
  const move = (direction: -1 | 1) => {
    const next = shiftMemoryDay(day, direction, today);
    onChange(next === today ? null : next);
  };
  return <View style={{ flexDirection: "row", alignItems: "center" }}>
    <Pressable accessibilityRole="button" accessibilityLabel={copy[0]} onPress={() => move(-1)} style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="chevron-back" size={18} color={theme.colors.text} /></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`${day}, ${copy[2]}`} onPress={() => onChange(null)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{day}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={copy[1]} accessibilityState={{ disabled: day >= today }} disabled={day >= today} onPress={() => move(1)} style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center", opacity: day >= today ? 0.25 : 1 }}><Ionicons name="chevron-forward" size={18} color={theme.colors.text} /></Pressable>
  </View>;
}
