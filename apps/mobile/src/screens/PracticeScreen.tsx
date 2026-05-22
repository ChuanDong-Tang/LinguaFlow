import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlockingLoading, type BlockingLoadingOptions, runWithDeferredBlockingLoading } from "./shared/BlockingLoading";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import type { ChatMessage } from "../domain/chat/types";
import { filterByDate, isSameDate, toDateKey } from "../domain/chat/messageState";
import { ensureChatMessagesLoaded, replaceChatMessages } from "../services/chat/chatSessionService";
import { findConversationIdByDateFromCloud, listDayMessagesFromCloud } from "../services/api/chatHistoryApi";
import { PRACTICE_CONTACTS, type ChatContact } from "../domain/chat/contacts";
import { getSession } from "../services/auth/authStorage";
import { getCurrentEntitlement } from "../services/api/meApi";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
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
  const lastCloudSyncAtByDateRef = useRef<Record<string, number>>({});

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

  // 历史/练习数据以云端为准，但 5 分钟内重复进入同一天不再强拉，减少等待感。
  async function syncDateIfNeeded(date: Date): Promise<{ rows: ChatMessage[]; contactMap: Map<string, ChatContact> }> {
    const dateKey = toDateKey(date);
    const lastSyncedAt = lastCloudSyncAtByDateRef.current[dateKey] ?? 0;
    if (Date.now() - lastSyncedAt <= 5 * 60 * 1000) return { rows: messages, contactMap: contactByMessageId };
    if (!(await hasLocalProAccess())) return { rows: messages, contactMap: contactByMessageId };
    const session = await getSession();
    const entitlement = await getCurrentEntitlement().catch(() => null);
    const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";
    if (entitlement?.isPro !== true) return { rows: messages, contactMap: contactByMessageId };
    const syncedByContact = await Promise.all(
      PRACTICE_CONTACTS.map(async (contact) => {
        const conversationId = await findConversationIdByDateFromCloud({ dateKey, contactId: contact.id });
        if (!conversationId) return { contact, rows: [] as ChatMessage[] };
        const rows = await listDayMessagesFromCloud({ conversationId, userId, dateKey });
        return { contact, rows: rows.map(mapCloudMessage) };
      }),
    );
    const rest = messages.filter((row) => toDateKey(new Date(row.createdAt)) !== dateKey);
    const mergedRows = syncedByContact.flatMap((item) => item.rows);
    const next = [...rest, ...mergedRows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    const nextContactMap = new Map(contactByMessageId);
    for (const item of syncedByContact) {
      item.rows.forEach((row) => nextContactMap.set(row.id ?? row.localId, item.contact));
    }
    setMessages(next);
    setContactByMessageId(nextContactMap);
    await Promise.all(
      syncedByContact.map(async (item) => {
        const existing = await ensureChatMessagesLoaded(item.contact.id);
        const restForContact = existing.filter((row) => toDateKey(new Date(row.createdAt)) !== dateKey);
        await replaceChatMessages(item.contact.id, [...restForContact, ...item.rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)));
      }),
    );
    lastCloudSyncAtByDateRef.current[dateKey] = Date.now();
    return { rows: next, contactMap: nextContactMap };
  }

  // 日期入口：先确保该日数据新鲜，再按当天消息生成练习卡。
  async function openDatePractice(date: Date): Promise<void> {
    await runWithLoading(async () => {
      const { rows: nextMessages, contactMap } = await syncDateIfNeeded(date);
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
              <Ionicons name="chevron-back" size={27} color="#111111" />
            </Pressable>
            <Text style={styles.monthTitle}>{monthCursor.getFullYear()}年 {monthCursor.getMonth() + 1}月</Text>
            <Pressable style={styles.arrowButton} onPress={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
              <Ionicons name="chevron-forward" size={27} color="#111111" />
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

        <View style={styles.reviewRow}>
          <ReviewCard title="今日回顾" subtitle={`今天 · ${today.getMonth() + 1}月${today.getDate()}日`} body="进入今天需要复习的内容" onPress={() => void openDatePractice(today)} />
          <ReviewCard title="昨日回顾" subtitle={`昨天 · ${yesterday.getMonth() + 1}月${yesterday.getDate()}日`} body="查看昨天的复习记录" onPress={() => void openDatePractice(yesterday)} />
        </View>

        <Pressable style={styles.quickCard} onPress={resetAndOpenQuick}>
          <View style={styles.quickIcon}><Ionicons name="shuffle-outline" size={30} color="#111111" /></View>
          <View style={styles.quickBody}>
            <Text style={styles.quickTitle}>快速练习</Text>
            <Text style={styles.quickSubtitle}>随机开始一组练习</Text>
          </View>
          <Ionicons name="chevron-forward" size={25} color="#111111" />
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

function ReviewCard({ title, subtitle, body, onPress }: { title: string; subtitle: string; body: string; onPress: () => void }) {
  return (
    <Pressable style={styles.reviewCard} onPress={onPress}>
      <Text style={styles.reviewTitle}>{title}</Text>
      <Text style={styles.reviewSubtitle}>{subtitle}</Text>
      <Text style={styles.reviewBody}>{body}</Text>
      <View style={styles.reviewFoot}>
        <View style={styles.reviewIcon}><Ionicons name="calendar-outline" size={22} color="#111111" /></View>
        <Ionicons name="chevron-forward" size={24} color="#111111" />
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
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetScrim} onPress={props.onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetGrab} />
          <Text style={styles.sheetTitle}>快速练习</Text>
          <View style={styles.pickerRow}>
            <NumberColumn title="最近天数" value={props.recentDays} onChange={props.onChangeRecentDays} />
            <NumberColumn title="练习条数" value={props.limit} onChange={props.onChangeLimit} />
            <View style={styles.column}>
              <Text style={styles.columnTitle}>正确率</Text>
              <ScrollView style={styles.columnScroll} showsVerticalScrollIndicator={false}>
                {BAND_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[
                      styles.bandOption,
                      { backgroundColor: option.color },
                      props.band === option.value && styles.optionSelected,
                    ]}
                    onPress={() => props.onChangeBand(option.value)}
                  >
                    <Text style={styles.optionText}>{option.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
          <Pressable style={styles.startButton} onPress={props.onStart}>
            <Text style={styles.startButtonText}>开始</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function NumberColumn({ title, value, onChange }: { title: string; value: number; onChange: (value: number) => void }) {
  return (
    <View style={styles.column}>
      <Text style={styles.columnTitle}>{title}</Text>
      <ScrollView style={styles.columnScroll} showsVerticalScrollIndicator={false}>
        {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
          <Pressable key={n} style={[styles.numberOption, value === n && styles.optionSelected]} onPress={() => onChange(n)}>
            <Text style={styles.optionText}>{n}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function mapCloudMessage(row: {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "success" | "failed";
  content: string;
  createdAt: string;
  clozeState?: ChatMessage["clozeState"];
  clozeVersion?: number;
  clozePracticeDiscardedAt?: string | null;
}): ChatMessage {
  return {
    id: row.id,
    localId: row.id,
    role: row.role,
    text: row.content,
    time: new Date(row.createdAt).toTimeString().slice(0, 5),
    createdAt: row.createdAt,
    status: row.status,
    clozeState: row.clozeState ?? null,
    clozeVersion: row.clozeVersion ?? 0,
    clozePracticeDiscardedAt: row.clozePracticeDiscardedAt ?? null,
  };
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
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 26,
  },
  title: {
    marginBottom: 28,
    color: "#111111",
    fontSize: 24,
    fontWeight: "500",
    textAlign: "center",
  },

  calendarPanel: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#DDE1E8",
    backgroundColor: "#FFFFFF",
  },
  sectionTitle: {
    color: "#111111",
    fontSize: 24,
    fontWeight: "700",
  },
  monthRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrowButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    color: "#111111",
    fontSize: 22,
    fontWeight: "700",
  },
  weekRow: {
    marginTop: 22,
    flexDirection: "row",
  },
  weekText: {
    width: "14.28%",
    color: "#686E7C",
    fontSize: 16,
    textAlign: "center",
  },
  grid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: "14.28%",
    height: 47,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubble: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dayBubbleLow: {
    backgroundColor: "#F2EFFF",
  },
  dayBubbleMid: {
    backgroundColor: "#DDD8FF",
  },
  dayBubbleHigh: {
    backgroundColor: "#9185FF",
  },
  dayText: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "500",
  },
  dayTextMuted: {
    color: "#B7BCC7",
  },

  reviewRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
  },
  reviewCard: {
    flex: 1,
    minHeight: 150,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DDE1E8",
    backgroundColor: "#FFFFFF",
  },
  reviewTitle: {
    color: "#111111",
    fontSize: 22,
    fontWeight: "700",
  },
  reviewSubtitle: {
    marginTop: 10,
    color: "#616777",
    fontSize: 15,
  },
  reviewBody: {
    marginTop: 18,
    color: "#616777",
    fontSize: 15,
    lineHeight: 21,
  },
  reviewFoot: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },

  quickCard: {
    marginTop: 16,
    minHeight: 94,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DDE1E8",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
  },
  quickIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#F0ECFF",
    alignItems: "center",
    justifyContent: "center",
  },
  quickBody: {
    flex: 1,
    marginLeft: 18,
  },
  quickTitle: {
    color: "#111111",
    fontSize: 23,
    fontWeight: "700",
  },
  quickSubtitle: {
    marginTop: 5,
    color: "#697080",
    fontSize: 15,
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
    paddingHorizontal: 20,
    paddingBottom: 26,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: "#FFFFFF",
  },
  sheetGrab: {
    alignSelf: "center",
    marginTop: 9,
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#E1E3EA",
  },
  sheetTitle: {
    marginTop: 16,
    color: "#111111",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  pickerRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },
  column: {
    flex: 1,
  },
  columnTitle: {
    marginBottom: 8,
    color: "#5D6472",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  columnScroll: {
    height: 190,
  },
  numberOption: {
    height: 42,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: "#F6F7FA",
    alignItems: "center",
    justifyContent: "center",
  },
  bandOption: {
    minHeight: 42,
    marginBottom: 8,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: "#111111",
  },
  optionText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
  },
  startButton: {
    marginTop: 20,
    height: 52,
    borderRadius: 18,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
  },
  startButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
});
