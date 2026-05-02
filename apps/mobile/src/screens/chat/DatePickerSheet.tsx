import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

type DatePickerSheetProps = {
  visible: boolean;
  monthCursor: Date;
  selectedDate: Date;
  onClose: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (d: Date) => void;
  hasRecordDateKeys: Set<string>;
};

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export function DatePickerSheet({
  visible,
  monthCursor,
  selectedDate,
  onClose,
  onPrevMonth,
  onNextMonth,
  onSelectDate,
  hasRecordDateKeys,
}: DatePickerSheetProps) {
  const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);
  const title = `${monthCursor.getFullYear()}年${monthCursor.getMonth() + 1}月`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.scrim} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.grab} />

          <View style={styles.topRow}>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
            <Text style={styles.title}>选择日期</Text>
            <View style={styles.closeBtn} />
          </View>

          <View style={styles.monthRow}>
            <View style={styles.monthTitleWrap}>
              <Text style={styles.monthTitle}>{title}</Text>
              <Text style={styles.monthDrop}>⌄</Text>
            </View>
            <View style={styles.monthActions}>
              <Pressable onPress={onPrevMonth} style={styles.arrowBtn}>
                <Text style={styles.arrow}>‹</Text>
              </Pressable>
              <Pressable onPress={onNextMonth} style={styles.arrowBtn}>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.weekRow}>
            {WEEK_LABELS.map((w) => (
              <Text key={w} style={styles.weekText}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((c, idx) => {
              if (!c) {
                return <View key={`blank-${idx}`} style={styles.cell} />;
              }
              const isSelected = isSameDate(c, selectedDate);
              const hasRecord = hasRecordDateKeys.has(toDateKey(c));

              return (
                <Pressable
                  key={c.toISOString()}
                  style={styles.cell}
                  onPress={() => onSelectDate(c)}
                  disabled={!hasRecord}
                >
                  <View style={[styles.dayDot, isSelected && styles.dayDotSelected]}>
                    <Text
                      style={[
                        styles.dayText,
                        !hasRecord && styles.dayTextMuted,
                        isSelected && styles.dayTextSelected,
                      ]}
                    >
                      {c.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
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
  for (let i = 0; i < startWeekday; i += 1) result.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) result.push(new Date(year, month, d));
  while (result.length % 7 !== 0) result.push(null);
  return result;
}

function isSameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 26,
    minHeight: 560,
  },
  grab: {
    alignSelf: "center",
    marginTop: 8,
    width: 78,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#E3E5E9",
  },
  topRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 20, color: "#111111" },
  title: { fontSize: 18, fontWeight: "700", color: "#111111", letterSpacing: 0.2 },
  monthRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  monthTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  monthTitle: { fontSize: 18, fontWeight: "600", color: "#111111" },
  monthDrop: { fontSize: 16, color: "#5E6370", marginTop: 2 },
  monthActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  arrowBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 28, color: "#111111", lineHeight: 28 },
  weekRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weekText: {
    width: "14.28%",
    textAlign: "center",
    color: "#A0A5B1",
    fontSize: 13,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  dayDotSelected: {
    backgroundColor: "#6E6BFF",
  },
  dayText: {
    fontSize: 16,
    color: "#1E222B",
    fontWeight: "500",
  },
  dayTextMuted: {
    color: "#C5CAD4",
  },
  dayTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
