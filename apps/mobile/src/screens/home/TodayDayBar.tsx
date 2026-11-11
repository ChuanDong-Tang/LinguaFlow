import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { haptic } from "../../feedback/haptics";
import { getLanguage, t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { type HistoryDay } from "./todayDays";

const WEEKDAYS = {
  zh: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
  ja: ["日", "月", "火", "水", "木", "金", "土"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayTitle(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const weekday = new Date(year, month - 1, day, 12).getDay();
  const language = getLanguage();
  const thisYear = new Date().getFullYear() === year;
  if (language.startsWith("zh")) return `${thisYear ? "" : `${year}年`}${month}月${day}日 ${WEEKDAYS.zh[weekday]}`;
  if (language.startsWith("ja")) return `${thisYear ? "" : `${year}年`}${month}月${day}日(${WEEKDAYS.ja[weekday]})`;
  return `${WEEKDAYS.en[weekday]}, ${MONTHS_EN[month - 1]} ${day}${thisYear ? "" : `, ${year}`}`;
}

/**
 * 今日 tab day bar (2026-11): ‹ date › steps through days, the date opens the
 * calendar, 回到今天 returns, and "this day in history" chips jump back.
 */
export function TodayDayBar({ day, today, history, onChangeDay, onOpenCalendar, onOpenMenu }: {
  day: string;
  today: string;
  /** Only the history days that have cards. */
  history: HistoryDay[];
  onChangeDay: (dateKey: string) => void;
  onOpenCalendar: () => void;
  onOpenMenu: () => void;
}) {
  const isToday = day === today;
  const step = (direction: -1 | 1) => {
    const date = new Date(`${day}T12:00:00`);
    date.setDate(date.getDate() + direction);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (next > today) return;
    haptic.select();
    onChangeDay(next);
  };
  return <View style={styles.root}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("today.previous_day")} hitSlop={8} style={styles.arrow} onPress={() => step(-1)}>
        <Icon name="chevron-back" size={18} color={theme.colors.textSecondary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityHint={t("today.open_calendar")} hitSlop={6} style={({ pressed }) => [styles.dateButton, pressed && { opacity: 0.6 }]} onPress={() => { haptic.light(); onOpenCalendar(); }}>
        <Text style={styles.dateText}>{dayTitle(day)}</Text>
        <Icon name="calendar-outline" size={14} color={theme.colors.textMuted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t("today.next_day")} disabled={isToday} hitSlop={8} style={[styles.arrow, isToday && { opacity: 0.25 }]} onPress={() => step(1)}>
        <Icon name="chevron-forward" size={18} color={theme.colors.textSecondary} />
      </Pressable>
      <View style={{ flex: 1 }} />
      {!isToday ? <Pressable accessibilityRole="button" hitSlop={6} style={({ pressed }) => [styles.backToday, pressed && { opacity: 0.7 }]} onPress={() => { haptic.select(); onChangeDay(today); }}>
        <Text style={styles.backTodayText}>{t("today.back_to_today")}</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t("library.display_options")} hitSlop={6} style={styles.menuButton} onPress={onOpenMenu}>
        <Icon name="ellipsis-horizontal" size={21} color={theme.colors.textSecondary} />
      </Pressable>
    </View>
    {history.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {history.map((item) => {
        const selected = item.dateKey === day;
        return <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: 0.75 }]} onPress={() => { haptic.select(); onChangeDay(selected ? today : item.dateKey); }}>
          <Text style={[styles.chipText, selected && styles.chipTextOn]}>{t(`today.history.${item.key}` as "today.history.week")}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
  </View>;
}

const styles = createStyles(() => ({
  root: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 6, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 40 },
  arrow: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  dateButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4, minHeight: 36 },
  dateText: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  backToday: { minHeight: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: theme.colors.accentSoft, justifyContent: "center", marginRight: 4 },
  backTodayText: { color: theme.colors.accent, fontSize: 13, fontWeight: "700" },
  menuButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  chips: { gap: 8, paddingRight: 8 },
  chip: { minHeight: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: theme.colors.fill2, justifyContent: "center" },
  chipOn: { backgroundColor: theme.colors.accent },
  chipText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: theme.colors.onAccent },
}));
