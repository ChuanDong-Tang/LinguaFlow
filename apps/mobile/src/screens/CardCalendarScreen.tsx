import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { getCardCalendarSummary, getCardRecordPage, type CardCalendarSummary, type CardRecordSummary } from "../services/api/cardApi";
import { getLanguage, t, tf } from "../i18n";
import { dateKeyToDate, getBusinessDateKey } from "../services/time/serverClock";
import { theme } from "../theme";

type MonthKey = `${number}-${string}`;

export function CardCalendarScreen({ visible, onClose, onOpenCard, onSelectDate }: { visible: boolean; onClose: () => void; onOpenCard?: (recordId: string) => void; onSelectDate?: (dateKey: string) => void }) {
  const now = new Date();
  const insets = useSafeAreaInsets();
  const modalTopInset = insets.top > 0 ? insets.top : Platform.OS === "ios" ? 44 : 0;
  const [mode, setMode] = useState<"month" | "year">("month");
  const [monthCount, setMonthCount] = useState(6);
  const [firstRecordDateKey, setFirstRecordDateKey] = useState<string | null | undefined>(undefined);
  const [year, setYear] = useState(now.getFullYear());
  const [summaries, setSummaries] = useState<Record<string, CardCalendarSummary>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const pendingRecordIdRef = useRef<string | null>(null);
  const monthScrollRef = useRef<ScrollView>(null);
  const availableMonthCount = firstRecordDateKey
    ? Math.max(1, monthDistance(new Date(Number(firstRecordDateKey.slice(0, 4)), Number(firstRecordDateKey.slice(5, 7)) - 1, 1), now) + 1)
    : 1;
  const months = useMemo(() => Array.from({ length: Math.min(monthCount, availableMonthCount) }, (_, offset) => new Date(now.getFullYear(), now.getMonth() - offset, 1)), [availableMonthCount, monthCount, visible]);

  useEffect(() => {
    if (!visible) return;
    if (mode === "month") months.forEach((month) => void loadMonth(month));
    else void loadYear(year);
  }, [visible, mode, year, monthCount, firstRecordDateKey]);

  async function loadMonth(month: Date): Promise<void> {
    const key = monthKey(month);
    if (summaries[key] || loadingKeys.has(key)) return;
    setLoadingKeys((current) => new Set(current).add(key));
    try {
      const summary = await getCardCalendarSummary(dateKey(new Date(month.getFullYear(), month.getMonth(), 1)), dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0)));
      setFirstRecordDateKey(summary.firstRecordDateKey);
      setSummaries((current) => ({ ...current, [key]: summary }));
    } finally {
      setLoadingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  async function loadYear(value: number): Promise<void> {
    const key = `year:${value}`;
    if (summaries[key] || loadingKeys.has(key)) return;
    setLoadingKeys((current) => new Set(current).add(key));
    try {
      const summary = await getCardCalendarSummary(`${value}-01-01`, `${value}-12-31`);
      setFirstRecordDateKey(summary.firstRecordDateKey);
      setSummaries((current) => ({ ...current, [key]: summary }));
    } finally {
      setLoadingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  return <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="fullScreen"
    onRequestClose={onClose}
    onDismiss={() => {
      const recordId = pendingRecordIdRef.current;
      pendingRecordIdRef.current = null;
      if (recordId) onOpenCard?.(recordId);
    }}
  >
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.page, { paddingTop: modalTopInset }]}>
      <View style={styles.header}><Pressable style={styles.headerButton} onPress={onClose}><Ionicons name="close-outline" size={29} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{t("calendar.title")}</Text><View style={styles.headerButton} /></View>
      <View style={styles.tabs}>{(["month", "year"] as const).map((value) => <Pressable key={value} style={[styles.tab, mode === value && styles.tabActive]} onPress={() => setMode(value)}><Text style={[styles.tabText, mode === value && styles.tabTextActive]}>{t(`calendar.${value}`)}</Text></Pressable>)}</View>
      {mode === "month" ? <ScrollView ref={monthScrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.monthList} scrollEventThrottle={200} onScroll={({ nativeEvent }) => { const distance = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y; if (distance < 500) setMonthCount((count) => Math.min(availableMonthCount, count + 6)); }}>
        {months.map((month) => <MonthPanel key={monthKey(month)} month={month} summary={summaries[monthKey(month)]} loading={loadingKeys.has(monthKey(month))} onSelectDate={(value) => onSelectDate ? onSelectDate(value) : setSelectedDateKey(value)} />)}
      </ScrollView> : <YearPanel year={year} summary={summaries[`year:${year}`]} loading={loadingKeys.has(`year:${year}`)} onPrevious={() => setYear((value) => value - 1)} onNext={() => setYear((value) => Math.min(now.getFullYear(), value + 1))} onSelectMonth={(month) => { const offset = (now.getFullYear() - year) * 12 + now.getMonth() - month; setMonthCount(Math.max(6, offset + 6)); setMode("month"); setTimeout(() => monthScrollRef.current?.scrollTo({ y: Math.max(0, offset * 500), animated: false }), 80); }} onSelectDate={(value) => onSelectDate ? onSelectDate(value) : setSelectedDateKey(value)} />}
      {!onSelectDate ? <DayCardsModal
        dateKeyValue={selectedDateKey}
        onClose={() => setSelectedDateKey(null)}
        onDismiss={() => {
          if (pendingRecordIdRef.current) onClose();
        }}
        onOpenCard={(recordId) => {
          pendingRecordIdRef.current = recordId;
          setSelectedDateKey(null);
        }}
      /> : null}
    </SafeAreaView>
  </Modal>;
}

export function CalendarSidebarPreview({ onPress }: { onPress: () => void }) {
  const [summary, setSummary] = useState<CardCalendarSummary | null>(null);
  const [todayKey, setTodayKey] = useState(() => dateKey(new Date()));
  const requestIdRef = useRef(0);

  useEffect(() => {
    let alive = true;

    async function loadSummary(): Promise<void> {
      const requestId = ++requestIdRef.current;
      try {
        const nextTodayKey = await getBusinessDateKey().catch(() => dateKey(new Date()));
        const today = dateKeyToDate(nextTodayKey);
        const oldestWeek = startOfWeekMonday(today);
        oldestWeek.setDate(oldestWeek.getDate() - 12 * 7);
        const nextSummary = await getCardCalendarSummary(dateKey(oldestWeek), nextTodayKey);
        if (!alive || requestId !== requestIdRef.current) return;
        setTodayKey(nextTodayKey);
        setSummary(nextSummary);
      } catch {
        // Keep the last successful preview when the sidebar refresh fails.
      }
    }

    void loadSummary();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadSummary();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  const today = dateKeyToDate(todayKey);
  const currentWeek = startOfWeekMonday(today);
  const firstWeek = new Date(currentWeek);
  firstWeek.setDate(firstWeek.getDate() - 12 * 7);
  const weeks = Array.from({ length: 13 }, (_, weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => {
    const day = new Date(firstWeek);
    day.setDate(firstWeek.getDate() + weekIndex * 7 + dayIndex);
    return day;
  }));
  const monthLabels = Array.from({ length: 3 }, (_, index) => new Date(today.getFullYear(), today.getMonth() - 2 + index, 1)).map((month) => ({
    month,
    weekIndex: Math.max(0, Math.min(12, Math.round(calendarDayDistance(firstWeek, startOfWeekMonday(month)) / 7))),
  }));
  const byDate = new Map(summary?.days.map((day) => [day.dateKey, day]) ?? []);
  return <Pressable style={styles.sidebarPreview} onPress={onPress}>
    <View style={styles.sidebarStats}><View style={styles.sidebarStatItem}><Text style={styles.sidebarStatValue}>{summary?.totals.cardCount ?? 0}</Text><Text style={styles.sidebarStatLabel}>{t("calendar.cards")}</Text></View><View style={[styles.sidebarStatItem, styles.sidebarStatItemRight]}><Text style={styles.sidebarStatValue}>{summary?.totals.recordedDays ?? 0}</Text><Text style={styles.sidebarStatLabel}>{t("calendar.recorded_days")}</Text></View></View>
    <View style={calendarSidebarStyles.heatmap}>
      {weeks.map((week, weekIndex) => <View key={`week:${weekIndex}`} style={calendarSidebarStyles.week}>
        {week.map((day) => {
          const key = dateKey(day);
          const stat = byDate.get(key);
          const isFuture = key > todayKey;
          return <View key={key} style={[
            calendarSidebarStyles.heatCell,
            isFuture ? calendarSidebarStyles.heatCellFuture : null,
            !isFuture && stat && stat.cardCount > 0 ? { backgroundColor: calendarHeatColor(stat) } : null,
          ]} />;
        })}
      </View>)}
    </View>
    <View style={calendarSidebarStyles.monthLabels}>
      {monthLabels.map(({ month, weekIndex }) => <Text
        key={monthKey(month)}
        style={[
          calendarSidebarStyles.monthLabel,
          weekIndex === 0
            ? calendarSidebarStyles.monthLabelFirst
            : weekIndex === 12
              ? calendarSidebarStyles.monthLabelLast
              : { left: `${(weekIndex / 12) * 100}%`, transform: [{ translateX: -20 }] },
        ]}
      >{new Intl.DateTimeFormat(getLanguage(), { month: "short" }).format(month)}</Text>)}
    </View>
  </Pressable>;
}

function MonthPanel({ month, summary, loading, onSelectDate }: { month: Date; summary?: CardCalendarSummary; loading: boolean; onSelectDate: (value: string) => void }) {
  const days = summary?.days ?? [];
  const byDate = new Map(days.map((day) => [day.dateKey, day]));
  const cells = monthCells(month);
  return <View style={styles.monthPanel}>
    <View style={styles.monthHeader}><Text style={styles.monthTitle}>{new Intl.DateTimeFormat(getLanguage(), { year: "numeric", month: "long" }).format(month)}</Text>{loading ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : null}</View>
    <Text style={styles.summary}>{tf("calendar.month_summary", { cards: summary?.totals.cardCount ?? 0, chars: summary?.totals.originalChars ?? 0, days: summary?.totals.recordedDays ?? 0 })}</Text>
    <View style={styles.weekRow}>{weekLabels().map((label, index) => <Text key={`${label}:${index}`} style={styles.weekLabel}>{label}</Text>)}</View>
    <View style={styles.grid}>{cells.map((day, index) => {
      if (!day) return <View key={`blank:${index}`} style={styles.dayCell} />;
      const key = dateKey(day); const stat = byDate.get(key);
      return <Pressable key={key} disabled={!stat} style={styles.dayCell} onPress={() => onSelectDate(key)}><Text style={styles.dayText}>{day.getDate()}</Text><View style={[styles.daySquare, stat && { backgroundColor: calendarHeatColor(stat) }]} /></Pressable>;
    })}</View>
  </View>;
}

function YearPanel({ year, summary, loading, onPrevious, onNext, onSelectMonth, onSelectDate }: { year: number; summary?: CardCalendarSummary; loading: boolean; onPrevious: () => void; onNext: () => void; onSelectMonth: (month: number) => void; onSelectDate: (value: string) => void }) {
  const now = new Date(); const byDate = new Map((summary?.days ?? []).map((day) => [day.dateKey, day]));
  return <ScrollView contentContainerStyle={styles.yearPage}><View style={styles.yearHeader}><Pressable style={styles.yearArrow} onPress={onPrevious}><Ionicons name="chevron-back" size={22} color={theme.colors.text} /></Pressable><Text style={styles.yearTitle}>{year}</Text><Pressable disabled={year >= now.getFullYear()} style={styles.yearArrow} onPress={onNext}><Ionicons name="chevron-forward" size={22} color={year >= now.getFullYear() ? theme.colors.border : theme.colors.text} /></Pressable></View>
    {loading ? <ActivityIndicator color={theme.colors.textMuted} /> : <Text style={styles.yearSummary}>{tf("calendar.year_summary", { cards: summary?.totals.cardCount ?? 0, chars: summary?.totals.originalChars ?? 0, days: summary?.totals.recordedDays ?? 0 })}</Text>}
    <View style={styles.yearGrid}>{Array.from({ length: 12 }, (_, month) => { const recorded = (summary?.days ?? []).filter((day) => Number(day.dateKey.slice(5, 7)) === month + 1); return <Pressable key={month} style={styles.miniMonth} onPress={() => onSelectMonth(month)}><Text style={styles.miniMonthTitle}>{new Intl.DateTimeFormat(getLanguage(), { month: "short" }).format(new Date(year, month, 1))}</Text><View style={styles.miniGrid}>{monthCells(new Date(year, month, 1)).map((day, index) => { if (!day) return <View key={index} style={styles.miniDay} />; const stat = byDate.get(dateKey(day)); return <Pressable key={dateKey(day)} disabled={!stat} style={[styles.miniDay, stat && { backgroundColor: calendarHeatColor(stat) }]} onPress={() => stat && onSelectDate(dateKey(day))} />; })}</View><Text style={styles.miniMeta}>{recorded.reduce((sum, day) => sum + day.cardCount, 0)}</Text></Pressable>; })}</View>
  </ScrollView>;
}

function DayCardsModal({ dateKeyValue, onClose, onDismiss, onOpenCard }: { dateKeyValue: string | null; onClose: () => void; onDismiss: () => void; onOpenCard: (recordId: string) => void }) {
  const [items, setItems] = useState<CardRecordSummary[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { if (!dateKeyValue) return; setItems([]); setCursor(null); void load(false); }, [dateKeyValue]);
  async function load(more: boolean): Promise<void> { if (!dateKeyValue || loading) return; setLoading(true); try { const page = await getCardRecordPage({ dateKey: dateKeyValue, cursor: more ? cursor ?? undefined : undefined, limit: 50 }); setItems((current) => more ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); } finally { setLoading(false); } }
  return <Modal visible={Boolean(dateKeyValue)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}><SafeAreaView style={styles.dayPage}><View style={styles.header}><Pressable style={styles.headerButton} onPress={onClose}><Ionicons name="close-outline" size={28} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{dateKeyValue}</Text><View style={styles.headerButton} /></View><ScrollView style={styles.dayListScroller} contentContainerStyle={styles.dayList} onScroll={({ nativeEvent }) => { const distance = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y; if (distance < 250 && cursor) void load(true); }} scrollEventThrottle={200}>{items.map((item) => <Pressable key={item.id} style={styles.dayCard} onPress={() => onOpenCard(item.id)}><Text style={styles.dayCardTitle}>{item.displayTitle}</Text><Text numberOfLines={3} style={styles.dayCardText}>{item.rewrittenPreview?.trim() || item.originalPreview}</Text></Pressable>)}{loading ? <ActivityIndicator color={theme.colors.textMuted} /> : null}</ScrollView></SafeAreaView></Modal>;
}
function monthKey(date: Date): MonthKey { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function dateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function monthDistance(from: Date, to: Date): number { return (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth(); }
function monthCells(month: Date): Array<Date | null> { const result: Array<Date | null> = Array(month.getDay()).fill(null); const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); for (let day = 1; day <= count; day += 1) result.push(new Date(month.getFullYear(), month.getMonth(), day)); while (result.length % 7) result.push(null); return result; }
function startOfWeekMonday(date: Date): Date { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const weekday = result.getDay(); result.setDate(result.getDate() - (weekday === 0 ? 6 : weekday - 1)); return result; }
function calendarDayDistance(from: Date, to: Date): number { return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000); }
function weekLabels(): string[] { const base = new Date(2026, 7, 2); return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(getLanguage(), { weekday: "narrow" }).format(new Date(base.getFullYear(), base.getMonth(), base.getDate() + index))); }

function calendarHeatColor(day: CardCalendarSummary["days"][number]): string {
  const blankCount = Number(day.clozeBlankCount ?? 0);
  const attemptedCount = Number(day.clozeAttemptedBlankCount ?? 0);
  const correctCount = Number(day.clozeCorrectBlankCount ?? 0);
  // A recorded day must remain distinguishable even before the user creates a cloze.
  // The nullish fallbacks also keep clients readable while an older API is being deployed.
  if (!Number.isFinite(blankCount) || blankCount <= 0) return "rgba(73, 159, 96, 0.13)";
  const quantityWeight = Math.sqrt(Math.min(1, blankCount / 10));
  const accuracy = attemptedCount > 0
    ? Math.max(0, Math.min(1, correctCount / attemptedCount))
    : 0;
  const opacity = 0.16 + 0.72 * quantityWeight * (0.3 + 0.7 * accuracy);
  return `rgba(73, 159, 96, ${Math.min(0.88, opacity)})`;
}

const calendarSidebarStyles = StyleSheet.create({
  heatmap: {
    width: "100%",
    marginTop: 13,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  week: {
    gap: 3,
  },
  heatCell: {
    width: 14,
    height: 14,
    borderRadius: 3,
    backgroundColor: theme.colors.surfaceMuted,
  },
  heatCellFuture: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  monthLabels: {
    position: "relative",
    width: "100%",
    height: 16,
    marginTop: 7,
  },
  monthLabel: {
    position: "absolute",
    width: 40,
    color: theme.colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    textAlign: "center",
  },
  monthLabelFirst: {
    left: 0,
    textAlign: "left",
  },
  monthLabelLast: {
    right: 0,
    textAlign: "right",
  },
});

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: theme.colors.surface }, header: { height: 56, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" }, headerButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center" }, headerTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 18, fontWeight: "700" }, tabs: { alignSelf: "center", padding: 3, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row" }, tab: { minWidth: 110, paddingVertical: 9, borderRadius: 8, alignItems: "center" }, tabActive: { backgroundColor: theme.colors.surface }, tabText: { color: theme.colors.textMuted, fontSize: 15 }, tabTextActive: { color: theme.colors.text, fontWeight: "600" }, monthList: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 44 }, monthPanel: { paddingTop: 24, paddingBottom: 22 }, monthHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, monthTitle: { color: theme.colors.text, fontSize: 23, lineHeight: 30, fontWeight: "700" }, summary: { marginTop: 4, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 }, weekRow: { marginTop: 20, flexDirection: "row" }, weekLabel: { width: "14.285%", color: theme.colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: "center" }, grid: { marginTop: 8, flexDirection: "row", flexWrap: "wrap" }, dayCell: { width: "14.285%", height: 72, paddingHorizontal: 3, alignItems: "stretch" }, dayText: { height: 20, marginBottom: 3, color: theme.colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: "center" }, daySquare: { width: "100%", aspectRatio: 1, borderRadius: 7, backgroundColor: theme.colors.surfaceMuted }, yearPage: { paddingHorizontal: 18, paddingBottom: 40 }, yearHeader: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 }, yearArrow: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, yearTitle: { color: theme.colors.text, fontSize: 24, fontWeight: "700" }, yearSummary: { marginTop: 6, color: theme.colors.textMuted, textAlign: "center", fontSize: 12 }, yearGrid: { marginTop: 22, flexDirection: "row", flexWrap: "wrap", gap: 12 }, miniMonth: { width: "47%", padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 10 }, miniMonthTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "600" }, miniGrid: { marginTop: 8, flexDirection: "row", flexWrap: "wrap" }, miniDay: { width: "14.285%", aspectRatio: 1, borderWidth: 1.5, borderColor: theme.colors.surface, borderRadius: 2, backgroundColor: theme.colors.surfaceMuted }, miniMeta: { marginTop: 6, color: theme.colors.textMuted, fontSize: 10, textAlign: "right" }, sidebarPreview: { marginHorizontal: 12, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 14 }, sidebarStats: { flexDirection: "row", justifyContent: "space-between" }, sidebarStatItem: { flex: 1 }, sidebarStatItemRight: { alignItems: "flex-end" }, sidebarStatValue: { color: theme.colors.text, fontSize: 23, lineHeight: 29, fontWeight: "500" }, sidebarStatLabel: { marginTop: 1, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 }, sidebarHeatmap: { width: "100%", marginTop: 13, flexDirection: "row", justifyContent: "space-between" }, sidebarHeatWeek: { gap: 3 }, sidebarHeatCell: { width: 14, height: 14, borderRadius: 3, backgroundColor: theme.colors.surfaceMuted }, sidebarHeatCellActive: { backgroundColor: theme.colors.accentStrong }, sidebarMonths: { width: "100%", marginTop: 7, flexDirection: "row" }, sidebarMonthText: { width: "33.333%", color: theme.colors.textMuted, fontSize: 10, lineHeight: 14, textAlign: "center" }, dayPage: { flex: 1, backgroundColor: theme.colors.surface }, dayListScroller: { flex: 1 }, dayList: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 28, gap: 0 }, dayCard: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }, dayCardTitle: { color: theme.colors.text, fontSize: 16, lineHeight: 23, fontWeight: "600" }, dayCardText: { marginTop: 5, color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 } });
