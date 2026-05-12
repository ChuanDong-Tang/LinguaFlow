import React, { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

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

export function DatePickerSheet({ visible, monthCursor, selectedDate, onClose, onPrevMonth, onNextMonth, onSelectDate, hasRecordDateKeys }: DatePickerSheetProps) {
  const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);
  const title = `${monthCursor.getFullYear()}年${monthCursor.getMonth() + 1}月`;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}><Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <View style={styles.topRow}><Pressable style={styles.closeBtn} onPress={onClose}><Ionicons name="close" size={26} color="#111111" /></Pressable><Text style={styles.title}>选择日期</Text><View style={styles.closeBtn} /></View>
          <View style={styles.monthRow}><View style={styles.monthTitleWrap}><Text style={styles.monthTitle}>{title}</Text><Ionicons name="chevron-down" size={16} color="#5E6370" /></View><View style={styles.monthActions}><Pressable onPress={onPrevMonth} style={styles.arrowBtn}><Ionicons name="chevron-back" size={24} color="#111111" /></Pressable><Pressable onPress={onNextMonth} style={styles.arrowBtn}><Ionicons name="chevron-forward" size={24} color="#111111" /></Pressable></View></View>
          <View style={styles.weekRow}>{WEEK_LABELS.map((w) => (<Text key={w} style={styles.weekText}>{w}</Text>))}</View>
          <View style={styles.grid}>{cells.map((c, idx) => {
            if (!c) return <View key={`blank-${idx}`} style={styles.cell} />;
            const isSelected = isSameDate(c, selectedDate);
            const hasRecord = hasRecordDateKeys.has(toDateKey(c));
            return <Pressable key={c.toISOString()} style={styles.cell} onPress={() => onSelectDate(c)} disabled={!hasRecord}><View style={[styles.dayDot, isSelected && styles.dayDotSelected]}><Text style={[styles.dayText, !hasRecord && styles.dayTextMuted, isSelected && styles.dayTextSelected]}>{c.getDate()}</Text></View></Pressable>;
          })}</View>
        </View>
      </View>
    </Modal>
  );
}

function buildMonthCells(monthCursor: Date): Array<Date | null> { const y = monthCursor.getFullYear(); const m = monthCursor.getMonth(); const firstDay = new Date(y, m, 1); const startWeekday = firstDay.getDay(); const daysInMonth = new Date(y, m + 1, 0).getDate(); const result: Array<Date | null> = []; for (let i = 0; i < startWeekday; i += 1) result.push(null); for (let d = 1; d <= daysInMonth; d += 1) result.push(new Date(y, m, d)); while (result.length % 7 !== 0) result.push(null); return result; }
function isSameDate(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function toDateKey(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.12)" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: 24, minHeight: 560 },
  grab: { alignSelf: "center", marginTop: 8, width: 64, height: 5, borderRadius: 999, backgroundColor: "#E3E5E9" },
  topRow: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "700", color: "#111111" },
  monthRow: { marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  monthTitle: { fontSize: 17, fontWeight: "600", color: "#111111" },
  monthActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  arrowBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  weekRow: { marginTop: 16, flexDirection: "row", justifyContent: "space-between" },
  weekText: { width: "14.28%", textAlign: "center", color: "#A0A5B1", fontSize: 12 },
  grid: { marginTop: 10, flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  dayDotSelected: { backgroundColor: "#E9E4FF" },
  dayText: { fontSize: 15, color: "#1E222B", fontWeight: "500" },
  dayTextMuted: { color: "#C5CAD4" },
  dayTextSelected: { color: "#111111", fontWeight: "700" },
});
