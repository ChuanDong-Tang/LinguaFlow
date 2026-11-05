import React from "react";
import { Pressable, View } from "react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { getLanguage } from "../../i18n";
import { theme } from "../../theme";

const labels = {
  "zh-CN": ["上一张", "下一张", "返回回忆", "再看一组"],
  "zh-TW": ["上一張", "下一張", "返回回憶", "再看一組"],
  "en-US": ["Previous memory", "Next memory", "Back to memories", "Another set"],
  "ja-JP": ["前の思い出", "次の思い出", "思い出に戻る", "次のセット"],
};

export function MemoryBrowseControl({ index, total, disabled, hasNextSet = false, onPrevious, onNext, onExit }: {
  index: number; total: number; disabled: boolean;
  hasNextSet?: boolean;
  onPrevious?: () => void; onNext?: () => void; onExit: () => void;
}) {
  const copy = labels[getLanguage() as keyof typeof labels] ?? labels["en-US"];
  const last = index >= total - 1;
  if (total <= 1 && !hasNextSet) return null;
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={copy[0]} disabled={disabled || !onPrevious} style={{ padding: 12, opacity: disabled || !onPrevious ? 0.25 : 1 }} onPress={onPrevious}><Icon name="chevron-back" size={18} color={theme.colors.textSecondary} /></Pressable>
    <Text style={{ fontSize: 13, color: theme.colors.textMuted }}>{index + 1} / {total}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={last ? copy[hasNextSet ? 3 : 2] : copy[1]} disabled={disabled || (!last && !onNext)} style={{ minHeight: 44, minWidth: 44, padding: 12, justifyContent: "center", opacity: disabled || (!last && !onNext) ? 0.25 : 1 }} onPress={last ? onExit : onNext}>{last ? <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{copy[hasNextSet ? 3 : 2]}</Text> : <Icon name="chevron-forward" size={18} color={theme.colors.textSecondary} />}</Pressable>
  </View>;
}
