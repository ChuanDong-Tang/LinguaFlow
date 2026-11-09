import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/Typography";
import { getLanguage, t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";

export function MemoryCollectionFilters({ collections, selected, onSelect, onTouching }: {
  editorial?: boolean;
  collections: ReadonlyArray<{ id: string; name: string }>;
  selected: string;
  onSelect: (id: string) => void;
  onTouching: (touching: boolean) => void;
}) {
  const all = ({ "zh-CN": "全部", "zh-TW": "全部", "en-US": "All", "ja-JP": "すべて" } as Record<string, string>)[getLanguage()] ?? "All";
  const options = [{ id: "all", name: all }, { id: "favorites", name: `★ ${t("library.favorites")}` }, ...collections, { id: "unclassified", name: t("sidebar.unclassified") }];
  return <View onTouchStart={() => onTouching(true)} onTouchEnd={() => onTouching(false)} onTouchCancel={() => onTouching(false)}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: selected === option.id }} style={[styles.chip, selected === option.id && styles.selectedChip]} onPress={() => onSelect(option.id)}>
        <Text numberOfLines={1} style={[styles.label, selected === option.id && styles.selectedLabel]}>{option.name}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}

const styles = createStyles(() => ({
  // Xiaohongshu-style channel row: plain text, the active one bold. No pills.
  row: { gap: 4, paddingHorizontal: theme.gutter - 10, paddingVertical: 4 },
  chip: { minHeight: 36, maxWidth: 180, paddingHorizontal: 10, justifyContent: "center" },
  selectedChip: {},
  label: { fontSize: 15, color: theme.colors.textMuted },
  selectedLabel: { color: theme.colors.text, fontWeight: "600" },
}));
