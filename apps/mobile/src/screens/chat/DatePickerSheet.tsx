import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { t, tf } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";

type DatePickerSheetProps = {
  visible: boolean;
  monthCursor: Date;
  selectedDate: Date;
  onClose: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (d: Date) => void;
  hasRecordDateKeys: Set<string>;
  allowEmptyDates?: boolean;
  maximumDate?: Date;
};

const WEEK_LABEL_KEYS = [
  "chat.date.week.sun",
  "chat.date.week.mon",
  "chat.date.week.tue",
  "chat.date.week.wed",
  "chat.date.week.thu",
  "chat.date.week.fri",
  "chat.date.week.sat",
] as const;

export function DatePickerSheet({ visible, monthCursor, selectedDate, onClose, onPrevMonth, onNextMonth, onSelectDate, hasRecordDateKeys, allowEmptyDates = false, maximumDate }: DatePickerSheetProps) {
  const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);
  const title = tf("chat.date.month_format", {
    year: monthCursor.getFullYear(),
    month: monthCursor.getMonth() + 1,
  });

  function renderDayCell(cellDate: Date | null, index: number) {
    if (!cellDate) {
      return <View key={`blank-${index}`} style={styles.cell} />;
    }

    const isSelected = isSameDate(cellDate, selectedDate);
    const hasRecord = hasRecordDateKeys.has(toDateKey(cellDate));
    const isMaximumDate = maximumDate ? isSameDate(cellDate, maximumDate) : false;
    const afterMaximum = maximumDate ? startOfDay(cellDate).getTime() > startOfDay(maximumDate).getTime() : false;
    const disabled = afterMaximum || (!allowEmptyDates && !hasRecord && !isMaximumDate);
    const isActiveSelected = isSelected && !disabled;

    return (
      <Pressable
        key={cellDate.toISOString()}
        style={styles.cell}
        onPress={() => onSelectDate(cellDate)}
        disabled={disabled}
      >
        <View style={[styles.dayDot, hasRecord && styles.dayDotRecorded, isActiveSelected && styles.dayDotSelected]}>
          <Text style={[styles.dayText, disabled && styles.dayTextMuted, isActiveSelected && styles.dayTextSelected]}>
            {cellDate.getDate()}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.scrim} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.grab} />

          <View style={styles.topRow}>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Icon name="close" size={26} color={theme.colors.text} />
            </Pressable>
            <Text style={styles.title}>{t("chat.date.select")}</Text>
            <View style={styles.closeBtn} />
          </View>

          <View style={styles.monthRow}>
            <View style={styles.monthTitleWrap}>
              <Text style={styles.monthTitle}>{title}</Text>
              <Icon name="chevron-down" size={16} color={theme.colors.textSecondary} />
            </View>

            <View style={styles.monthActions}>
              <Pressable onPress={onPrevMonth} style={styles.arrowBtn}>
                <Icon name="chevron-back" size={24} color={theme.colors.text} />
              </Pressable>
              <Pressable onPress={onNextMonth} style={styles.arrowBtn}>
                <Icon name="chevron-forward" size={24} color={theme.colors.text} />
              </Pressable>
            </View>
          </View>

          <View style={styles.weekRow}>
            {WEEK_LABEL_KEYS.map((weekKey) => (
              <Text key={weekKey} style={styles.weekText}>
                {t(weekKey)}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>{cells.map(renderDayCell)}</View>
        </View>
      </View>
    </Modal>
  );
}

function buildMonthCells(monthCursor: Date): Array<Date | null> {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result: Array<Date | null> = [];

  // 用 null 补齐月初前的空格，让日期自然落到对应星期列。
  for (let i = 0; i < startWeekday; i += 1) {
    result.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    result.push(new Date(year, month, day));
  }

  // 用 null 补齐最后一行，避免网格尾部缺列导致布局跳动。
  while (result.length % 7 !== 0) {
    result.push(null);
  }

  return result;
}

function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const styles = createStyles(() => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  sheet: {
    minHeight: 560,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 22,
    paddingBottom: 24,
  },
  grab: {
    alignSelf: "center",
    width: 64,
    height: 5,
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceMuted,
  },
  topRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  monthRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  monthTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
  monthActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  arrowBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  weekRow: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weekText: {
    width: "14.28%",
    color: theme.colors.textFaint,
    fontSize: 12,
    textAlign: "center",
  },
  grid: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDotSelected: {
    backgroundColor: theme.colors.success,
  },
  dayDotRecorded: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  dayText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  dayTextMuted: {
    color: theme.colors.textFaint,
  },
  dayTextSelected: {
    color: theme.colors.text,
    fontWeight: "700",
  },
}));
