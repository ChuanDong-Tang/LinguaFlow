import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlockingLoading, type BlockingLoadingOptions, runWithDeferredBlockingLoading } from "./shared/BlockingLoading";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import type { ChatMessage } from "../domain/chat/types";
import { filterByDate, isSameDate, toDateKey } from "../domain/chat/messageState";
import { ensureChatMessagesLoaded } from "../services/chat/chatSessionService";
import { PRACTICE_CONTACTS, type ChatContact } from "../domain/chat/contacts";
import { useMountedGuard } from "../hooks/useMountedGuard";
import {
  buildPracticeCards,
  filterPracticeCards,
  summarizePracticeDays,
  type PracticeAccuracyBand,
  type PracticeCard,
} from "../domain/practice/practiceService";

type PracticeScreenProps = {
  onOpenPracticeSession: (cards: PracticeCard[], allMessages: ChatMessage[]) => void;
};

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const BAND_OPTIONS: Array<{ label: string; value: PracticeAccuracyBand; color: string }> = [
  { label: "都可以", value: "any", color: "#F0F1F5" },
  { label: "0-20%", value: "low", color: "#F1EEFF" },
  { label: "20-60%", value: "mid", color: "#DED9FF" },
  { label: "60%+", value: "high", color: "#AFA5FF" },
];
const RECENT_DAY_OPTIONS = [3, 7, 14, 30];
const QUICK_LIMIT_OPTIONS = [5, 10, 20, 30];

export function PracticeScreen({ onOpenPracticeSession }: PracticeScreenProps) {
  const { isMounted } = useMountedGuard();
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contactByMessageId, setContactByMessageId] = useState<Map<string, ChatContact>>(new Map());
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [recentDays, setRecentDays] = useState(7);
  const [quickLimit, setQuickLimit] = useState(10);
  const [band, setBand] = useState<PracticeAccuracyBand>("any");

  useEffect(() => {
    void loadPracticeMessagesFromLocal().then(({ rows, contactMap }) => {
      if (!isMounted()) return;
      setMessages(rows);
      setContactByMessageId(contactMap);
    });
  }, [isMounted]);

  const dayStats = useMemo(() => summarizePracticeDays(messages, { contactByMessageId }), [contactByMessageId, messages]);
  const cells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  async function runWithLoading<T>(task: (signal: AbortSignal) => Promise<T>, text?: string): Promise<T> {
    return runWithDeferredBlockingLoading(
      task,
      { show: setLoadingOptions, hide: () => setLoadingOptions(null) },
      {
        text,
        blocking: true,
        abortable: true,
        cancelableAfterMs: 10000,
        timeoutMs: 20000,
        onTimeout: () => setDialog({ message: "处理超时，请稍后重试。" }),
      },
    );
  }

  // 练习模块只消费聊天模块维护好的本地消息，不在打开练习前重复拉云端历史。
  // 聊天页负责按天同步、挖空保存和冲突处理；练习页只从本地缓存生成卡片。
  // 练习过程中产生的答题/丢弃仍在 PracticeSessionScreen 里按需写云端。
  async function openDatePractice(date: Date): Promise<void> {
    await runWithLoading(async () => {
      const { rows: nextMessages, contactMap } = await loadPracticeMessagesFromLocal();
      setMessages(nextMessages);
      setContactByMessageId(contactMap);
      const nextCards = buildPracticeCards(filterByDate(nextMessages, date), { contactByMessageId: contactMap });
      if (!nextCards.length) {
        setDialog({ message: "这一天没有可练习的填空。" });
        return;
      }
      onOpenPracticeSession(nextCards, nextMessages);
    });
  }

  // 快速练习只随机挑选符合条件的现有练习卡，不记忆用户这次的筛选条件。
  async function openQuickPractice(): Promise<void> {
    await runWithLoading(async () => {
      const { rows: nextMessages, contactMap } = await loadPracticeMessagesFromLocal();
      setMessages(nextMessages);
      setContactByMessageId(contactMap);
      const picked = filterPracticeCards({
        cards: buildPracticeCards(nextMessages, { contactByMessageId: contactMap }),
        recentDays,
        limit: quickLimit,
        band,
      });
      if (!picked.length) {
        setDialog({ message: "没有检索到合适的，请调整选项。" });
        return;
      }
      setQuickOpen(false);
      onOpenPracticeSession(picked, nextMessages);
    });
  }

  function resetAndOpenQuick(): void {
    setRecentDays(7);
    setQuickLimit(10);
    setBand("any");
    setQuickOpen(true);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>练习</Text>

        <View style={styles.calendarPanel}>
          <Text style={styles.sectionTitle}>日历</Text>
          <View style={styles.monthRow}>
            <Pressable style={styles.arrowButton} onPress={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
              <Ionicons name="chevron-back" size={22} color="#111111" />
            </Pressable>
            <Text style={styles.monthTitle}>{monthCursor.getFullYear()}年 {monthCursor.getMonth() + 1}月</Text>
            <Pressable style={styles.arrowButton} onPress={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
              <Ionicons name="chevron-forward" size={22} color="#111111" />
            </Pressable>
          </View>
          <View style={styles.weekRow}>{WEEK_LABELS.map((label) => <Text key={label} style={styles.weekText}>{label}</Text>)}</View>
          <View style={styles.grid}>
            {cells.map((cell, index) => {
              if (!cell.date) return <View key={`blank-${index}`} style={styles.dayCell} />;
              const key = toDateKey(cell.date);
              const stats = dayStats.get(key);
              const isCurrentMonth = cell.date.getMonth() === monthCursor.getMonth();
              const enabled = isCurrentMonth && !!stats?.total;
              return (
                <Pressable key={key} style={styles.dayCell} disabled={!enabled} onPress={() => void openDatePractice(cell.date!)}>
                  <View style={[styles.dayBubble, enabled && bandBubble(stats.band)]}>
                    <Text style={[styles.dayText, (!enabled || !isCurrentMonth) && styles.dayTextMuted]}>{cell.date.getDate()}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.reviewStack}>
          <ReviewButton title="今日回顾" subtitle={`今天 · ${today.getMonth() + 1}月${today.getDate()}日`} onPress={() => void openDatePractice(today)} />
          <ReviewButton title="昨日回顾" subtitle={`昨天 · ${yesterday.getMonth() + 1}月${yesterday.getDate()}日`} onPress={() => void openDatePractice(yesterday)} />
        </View>

        <Pressable style={styles.quickCard} onPress={resetAndOpenQuick}>
          <View style={styles.quickIcon}><Ionicons name="shuffle-outline" size={22} color="#111111" /></View>
          <View style={styles.quickBody}>
            <Text style={styles.quickTitle}>快速练习</Text>
            <Text style={styles.quickSubtitle}>随机开始一组练习</Text>
          </View>
        </Pressable>
      </ScrollView>

      <QuickPracticeSheet
        visible={quickOpen}
        recentDays={recentDays}
        limit={quickLimit}
        band={band}
        onClose={() => setQuickOpen(false)}
        onChangeRecentDays={setRecentDays}
        onChangeLimit={setQuickLimit}
        onChangeBand={setBand}
        onStart={() => void openQuickPractice()}
      />
      <BlockingLoading visible={!!loadingOptions} options={loadingOptions} />
      <InfoDialog config={dialog} onClose={() => setDialog(null)} />
    </SafeAreaView>
  );
}

// 练习页的历史数据来源只有本地缓存。这个本地缓存由聊天页同步/保存后写入，
// 避免练习入口再次请求云端，减少进入练习时的等待和重复同步。
async function loadPracticeMessagesFromLocal(): Promise<{ rows: ChatMessage[]; contactMap: Map<string, ChatContact> }> {
  const chunks = await Promise.all(
    PRACTICE_CONTACTS.map(async (contact) => ({
      contact,
      rows: await ensureChatMessagesLoaded(contact.id),
    })),
  );
  const contactMap = new Map<string, ChatContact>();
  const rows = chunks
    .flatMap((chunk) => {
      chunk.rows.forEach((row) => contactMap.set(row.id ?? row.localId, chunk.contact));
      return chunk.rows;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { rows, contactMap };
}

function ReviewButton({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={styles.reviewButton} onPress={onPress}>
      <View style={styles.reviewIcon}><Ionicons name="calendar-outline" size={18} color="#111111" /></View>
      <View style={styles.reviewBody}>
        <Text style={styles.reviewTitle}>{title}</Text>
        <Text style={styles.reviewSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function QuickPracticeSheet(props: {
  visible: boolean;
  recentDays: number;
  limit: number;
  band: PracticeAccuracyBand;
  onClose: () => void;
  onChangeRecentDays: (value: number) => void;
  onChangeLimit: (value: number) => void;
  onChangeBand: (value: PracticeAccuracyBand) => void;
  onStart: () => void;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetScrim} onPress={props.onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetGrab} />
          <Text style={styles.sheetTitle}>快速练习</Text>
          <OptionGroup
            title="最近天数"
            options={RECENT_DAY_OPTIONS.map((value) => ({ label: `${value}天`, value }))}
            value={props.recentDays}
            onChange={props.onChangeRecentDays}
          />
          <OptionGroup
            title="练习条数"
            options={QUICK_LIMIT_OPTIONS.map((value) => ({ label: `${value}条`, value }))}
            value={props.limit}
            onChange={props.onChangeLimit}
          />
          <OptionGroup
            title="正确率"
            options={BAND_OPTIONS.map((option) => ({ label: option.label, value: option.value }))}
            value={props.band}
            onChange={props.onChangeBand}
          />
          <Pressable style={styles.startButton} onPress={props.onStart}>
            <Text style={styles.startButtonText}>开始</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function OptionGroup<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.optionGroupTitle}>{title}</Text>
      <View style={styles.optionRow}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              style={[styles.chipOption, selected && styles.chipOptionSelected]}
              onPress={() => onChange(option.value)}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function buildCalendarCells(monthCursor: Date): Array<{ date: Date | null }> {
  // 固定 6 行日历，并补齐前后月份日期，保证布局和参考图稳定一致。
  const y = monthCursor.getFullYear();
  const m = monthCursor.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const cells: Array<{ date: Date | null }> = [];
  const previousMonthDays = new Date(y, m, 0).getDate();
  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push({ date: new Date(y, m - 1, previousMonthDays - first.getDay() + i + 1) });
  }
  for (let d = 1; d <= days; d += 1) cells.push({ date: new Date(y, m, d) });
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ date: new Date(y, m + 1, nextDay) });
    nextDay += 1;
  }
  return cells;
}

function bandBubble(band: "low" | "mid" | "high") {
  if (band === "high") return styles.dayBubbleHigh;
  if (band === "mid") return styles.dayBubbleMid;
  return styles.dayBubbleLow;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 22,
  },
  title: {
    marginBottom: 16,
    color: "#111111",
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
  },

  calendarPanel: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    backgroundColor: "#FFFFFF",
  },
  sectionTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
  },
  monthRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrowButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "500",
  },
  weekRow: {
    marginTop: 12,
    flexDirection: "row",
  },
  weekText: {
    width: "14.28%",
    color: "#686E7C",
    fontSize: 12,
    textAlign: "center",
  },
  grid: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.28%",
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubble: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  dayBubbleLow: {
    backgroundColor: "#EAF3FF",
  },
  dayBubbleMid: {
    backgroundColor: "#E3F6EC",
  },
  dayBubbleHigh: {
    backgroundColor: "#FFE6C7",
  },
  dayText: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "400",
  },
  dayTextMuted: {
    color: "#B7BCC7",
  },

  reviewStack: {
    marginTop: 12,
    gap: 8,
  },
  reviewButton: {
    minHeight: 62,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  reviewTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
  },
  reviewSubtitle: {
    marginTop: 2,
    color: "#616777",
    fontSize: 12,
  },
  reviewBody: {
    flex: 1,
    marginLeft: 12,
  },
  reviewIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },

  quickCard: {
    marginTop: 12,
    minHeight: 62,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E3E6ED",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  quickIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  quickBody: {
    flex: 1,
    marginLeft: 12,
  },
  quickTitle: {
    color: "#111111",
    fontSize: 16,
    fontWeight: "500",
  },
  quickSubtitle: {
    marginTop: 2,
    color: "#697080",
    fontSize: 12,
  },

  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  sheet: {
    paddingHorizontal: 18,
    paddingBottom: 22,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "#FFFFFF",
  },
  sheetGrab: {
    alignSelf: "center",
    marginTop: 8,
    width: 46,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#E1E3EA",
  },
  sheetTitle: {
    marginTop: 14,
    color: "#111111",
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
  },
  optionGroup: {
    marginTop: 16,
  },
  optionGroupTitle: {
    marginBottom: 8,
    color: "#5D6472",
    fontSize: 12,
    fontWeight: "500",
  },
  optionRow: {
    flexDirection: "row",
    gap: 8,
  },
  chipOption: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#DFE3EA",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  chipOptionSelected: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  optionText: {
    color: "#5D6470",
    fontSize: 13,
    fontWeight: "500",
  },
  optionTextSelected: {
    color: "#FFFFFF",
  },
  startButton: {
    marginTop: 16,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  startButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
