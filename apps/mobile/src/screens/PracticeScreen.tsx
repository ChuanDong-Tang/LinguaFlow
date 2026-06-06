import React, { useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlockingLoading, type BlockingLoadingOptions, runWithDeferredBlockingLoading } from "./shared/BlockingLoading";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import { useFloatingNotice, type FloatingNoticeOptions } from "./shared/FloatingNotice";
import type { ChatMessage } from "../domain/chat/types";
import { filterByDate, toDateKey } from "../domain/chat/messageState";
import { loadPracticeLocalMessages } from "../services/chat/chatSessionService";
import {
  findConversationIdByDateFromCloud,
  listDayMessagesFromCloud,
  listPracticeDayStatsFromCloud,
  type MessageView,
} from "../services/api/chatHistoryApi";
import { getSession } from "../services/auth/authStorage";
import { PRACTICE_CONTACTS, type ChatContact } from "../domain/chat/contacts";
import { useMountedGuard } from "../hooks/useMountedGuard";
import { useExclusiveSyncMachine } from "../hooks/useExclusiveSyncMachine";
import {
  clearPracticeStatsDirtyForMonth,
  getCachedPracticeMonthStats,
  getPracticeMonthCacheKey,
  setCachedPracticeMonthStats,
} from "../services/chat/chatPracticeSyncState";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
import {
  buildPracticeCards,
  filterPracticeCards,
  summarizePracticeDays,
  type PracticeAccuracyBand,
  type PracticeCard,
  type PracticeDayStats,
} from "../domain/practice/practiceService";
import { dateKeyToDate, getBusinessDateKey } from "../services/time/serverClock";

type PracticeScreenProps = {
  isActive: boolean;
  onOpenPracticeSession: (cards: PracticeCard[], allMessages: ChatMessage[]) => void;
};

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const BAND_OPTIONS: Array<{ label: string; value: PracticeAccuracyBand; color: string }> = [
  { label: "都可以", value: "any", color: "#F1F5F2" },
  { label: "0-20%", value: "low", color: "#D7E6D9" },
  { label: "20-60%", value: "mid", color: "#ABD1B0" },
  { label: "60%+", value: "high", color: "#6FAE78" },
];
const RECENT_DAY_OPTIONS = [3, 7, 14, 30];
const QUICK_LIMIT_OPTIONS = [5, 10, 20, 30];

function getMessageIdentityKey(row: ChatMessage): string {
  return row.serverId ?? row.clientId ?? row.id ?? row.localId;
}

export function PracticeScreen({ isActive, onOpenPracticeSession }: PracticeScreenProps) {
  const { showNotice } = useFloatingNotice();
  const { isMounted } = useMountedGuard();
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contactByMessageId, setContactByMessageId] = useState<Map<string, ChatContact>>(new Map());
  const [practiceDayStats, setPracticeDayStats] = useState<Map<string, PracticeDayStats>>(new Map());
  const [isSyncingPracticeDateKeys, setIsSyncingPracticeDateKeys] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [recentDays, setRecentDays] = useState(7);
  const [quickLimit, setQuickLimit] = useState(10);
  const [band, setBand] = useState<PracticeAccuracyBand>("any");
  const [businessTodayKey, setBusinessTodayKey] = useState<string | null>(null);
  const loadedPracticeMonthKeysRef = useRef<Set<string>>(new Set());
  const lastPracticeSyncAtByDateKeyRef = useRef<Record<string, number>>({});
  const messagesRef = useRef<ChatMessage[]>([]);
  const contactByMessageIdRef = useRef<Map<string, ChatContact>>(new Map());
  const syncNoticeRef = useRef<{ hide: () => void; update: (next: Partial<FloatingNoticeOptions>) => void; kind: "calendar" | "messages" } | null>(null);
  const practiceMonthMachine = useExclusiveSyncMachine<"practice_month">();
  const practiceDayMachine = useExclusiveSyncMachine<"practice_day">();
  const practiceQuickMachine = useExclusiveSyncMachine<"practice_quick">();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isPro = await hasLocalProAccess();
      if (!isPro) {
        if (!cancelled && isMounted()) setBusinessTodayKey(toDateKey(new Date()));
        return;
      }

      try {
        const todayKey = await getBusinessDateKey();
        if (!cancelled && isMounted()) setBusinessTodayKey(todayKey);
      } catch {
        // 练习页离线时仍允许查看本地缓存；日期会暂时使用本机日期。
        if (!cancelled && isMounted()) setBusinessTodayKey(toDateKey(new Date()));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMounted]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void loadPracticeMessagesFromLocal().then(({ rows, contactMap }) => {
      if (cancelled || !isMounted()) return;
      applyPracticeMessages(rows, contactMap);
    });
    return () => {
      cancelled = true;
    };
  }, [isActive, isMounted]);

  useEffect(() => {
    if (!isActive) {
      // 练习页失活就取消当前同步，避免用户切走后旧请求继续回写页面状态。
      practiceMonthMachine.cancel();
      practiceDayMachine.cancel();
      practiceQuickMachine.cancel();
      setIsSyncingPracticeDateKeys(false);
      setLoadingOptions(null);
      syncNoticeRef.current?.hide();
      syncNoticeRef.current = null;
      return;
    }
    void syncPracticeMonthDateKeys(monthCursor);
  }, [isActive, monthCursor]);

  useEffect(() => {
    return () => {
      practiceMonthMachine.cancel();
      practiceDayMachine.cancel();
      practiceQuickMachine.cancel();
      syncNoticeRef.current?.hide();
      syncNoticeRef.current = null;
    };
  }, [practiceDayMachine.cancel, practiceMonthMachine.cancel, practiceQuickMachine.cancel, isActive, monthCursor]);

  const localDayStats = useMemo(() => {
    const stats = summarizePracticeDays(messages, { contactByMessageId });
    practiceDayStats.forEach((value, key) => stats.set(key, value));
    return stats;
  }, [contactByMessageId, messages, practiceDayStats]);
  const cells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);
  const today = businessTodayKey ? dateKeyToDate(businessTodayKey) : new Date();
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

  function applyPracticeMessages(rows: ChatMessage[], contactMap: Map<string, ChatContact>): void {
    messagesRef.current = rows;
    contactByMessageIdRef.current = contactMap;
    setMessages(rows);
    setContactByMessageId(contactMap);
  }

  function mergeIntoPracticeMessages(rows: ChatMessage[], contactMap: Map<string, ChatContact>): void {
    const merged = mergePracticeMessages(
      messagesRef.current,
      contactByMessageIdRef.current,
      rows,
      contactMap
    );
    applyPracticeMessages(merged.rows, merged.contactMap);
  }

  function mergePracticeDayStats(rows: PracticeDayStats[]): void {
    setPracticeDayStats((prev) => {
      const next = new Map(prev);
      rows.forEach((row) => next.set(row.dateKey, row));
      return next;
    });
  }

  function showDialogAfterInteractions(config: InfoDialogConfig): void {
    InteractionManager.runAfterInteractions(() => {
      if (isMounted()) setDialog(config);
    });
  }

  async function syncPracticeDate(date: Date, options?: { force?: boolean; signal?: AbortSignal }): Promise<void> {
    if (!(await hasLocalProAccess())) return;

    const dateKey = toDateKey(date);
    if (!options?.force && Date.now() - (lastPracticeSyncAtByDateKeyRef.current[dateKey] ?? 0) <= 5 * 60 * 1000) {
      return;
    }
    // 单日练习、快速练习、月索引是三条业务线，各自有自己的 machine，互不误伤。
    const { token, controller } = practiceDayMachine.begin("practice_day", dateKey);
    options?.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      // 点某一天进入练习时，只走全屏 loading，不再额外挂右上角 notice。
      practiceDayMachine.setPhase(token, "fetching");
      await syncPracticeDateKeys([dateKey], { ...options, syncToken: token, signal: controller.signal });
      lastPracticeSyncAtByDateKeyRef.current[dateKey] = Date.now();
      practiceDayMachine.setPhase(token, "settling");
    } finally {
      practiceDayMachine.settle(token);
    }
  }

  async function syncPracticeDateKeys(
    dateKeys: string[],
    options?: { force?: boolean; signal?: AbortSignal; syncToken?: number }
  ): Promise<void> {
    if (!dateKeys.length) return;
    if (!(await hasLocalProAccess())) return;

    const eligibleDateKeys = options?.force
      ? dateKeys
      : dateKeys.filter((dateKey) => Date.now() - (lastPracticeSyncAtByDateKeyRef.current[dateKey] ?? 0) > 5 * 60 * 1000);
    if (!eligibleDateKeys.length) return;
    if (options?.syncToken) {
      // 这里推进的是 day 业务 machine 的阶段，说明“真正要拉哪些日”的业务进度。
      practiceDayMachine.setPhase(options.syncToken, "fetching");
    }
    let rows: ChatMessage[];
    let contactMap: Map<string, ChatContact>;
    try {
      const cloud = await loadPracticeMessagesFromCloudByDateKeys(eligibleDateKeys, options?.signal);
      rows = cloud.rows;
      contactMap = cloud.contactMap;
    } catch (error) {
      if (isCloudAccessDeniedError(error)) return;
      throw error;
    }
    if (!isMounted()) return;
    if (options?.syncToken) {
      practiceDayMachine.setPhase(options.syncToken, "merging");
    }
    mergeIntoPracticeMessages(rows, contactMap);
    const now = Date.now();
    eligibleDateKeys.forEach((dateKey) => {
      lastPracticeSyncAtByDateKeyRef.current[dateKey] = now;
    });
    if (options?.syncToken) {
      practiceDayMachine.setPhase(options.syncToken, "settling");
    }
  }

  // 点击入口时再扫一遍本地桶，吃到刚刚聊天页同步/练习页写回的最新数据。
  // 同步日期和拉练习消息还没结束时直接无反应，右上角转圈提示负责告诉用户正在做什么。
  async function openDatePractice(date: Date): Promise<void> {
    if (isSyncingPracticeDateKeys) {
      showDialogAfterInteractions({ message: "正在同步练习日历，请稍后再试。" });
      return;
    }
    const result = await runWithLoading(async (signal): Promise<
      | { type: "empty" }
      | { type: "start"; cards: PracticeCard[]; messages: ChatMessage[] }
    > => {
      await syncPracticeDate(date, { force: false, signal });
      const { rows: localRows, contactMap: localContactMap } = await loadPracticeMessagesFromLocal();
      const { rows: nextMessages, contactMap } = mergePracticeMessages(
        messagesRef.current,
        contactByMessageIdRef.current,
        localRows,
        localContactMap
      );
      applyPracticeMessages(nextMessages, contactMap);
      const nextCards = buildPracticeCards(filterByDate(nextMessages, date), { contactByMessageId: contactMap });
      if (!nextCards.length) {
        return { type: "empty" };
      }
      return { type: "start", cards: nextCards, messages: nextMessages };
    });
    if (result.type === "empty") {
      showDialogAfterInteractions({ message: "这一天没有可练习的填空。" });
      return;
    }
    onOpenPracticeSession(result.cards, result.messages);
  }

  // 快速练习只随机挑选符合条件的现有练习卡，不记忆用户这次的筛选条件。
  async function openQuickPractice(): Promise<void> {
    if (isSyncingPracticeDateKeys) {
      showDialogAfterInteractions({ message: "正在同步练习日历，请稍后再试。" });
      return;
    }
    const result = await runWithLoading(async (signal): Promise<
      | { type: "offline" }
      | { type: "empty" }
      | { type: "start"; cards: PracticeCard[]; messages: ChatMessage[] }
    > => {
      const isPro = await hasLocalProAccess();
      const todayKey = isPro
        ? await getBusinessDateKey().catch(() => null)
        : businessTodayKey ?? toDateKey(new Date());
      if (!todayKey) {
        return { type: "offline" };
      }
      if (isMounted()) setBusinessTodayKey(todayKey);
      const recentDateKeys = collectRecentPracticeDateKeys(recentDays, todayKey);
      const { token, controller } = practiceQuickMachine.begin("practice_quick", recentDateKeys.join(","));
      signal.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        await syncPracticeDateKeys(recentDateKeys, { force: false, signal: controller.signal, syncToken: token });
      } finally {
        practiceQuickMachine.settle(token);
      }
      const { rows: localRows, contactMap: localContactMap } = await loadPracticeMessagesFromLocal();
      const { rows: nextMessages, contactMap } = mergePracticeMessages(
        messagesRef.current,
        contactByMessageIdRef.current,
        localRows,
        localContactMap
      );
      applyPracticeMessages(nextMessages, contactMap);
      const picked = filterPracticeCards({
        cards: buildPracticeCards(nextMessages, { contactByMessageId: contactMap }),
        recentDays,
        limit: quickLimit,
        band,
      });
      if (!picked.length) {
        return { type: "empty" };
      }
      return { type: "start", cards: picked, messages: nextMessages };
    });
    if (result.type === "offline") {
      showDialogAfterInteractions({ message: "当前网络不可用，请连接网络后再试。" });
      return;
    }
    if (result.type === "empty") {
      showDialogAfterInteractions({ message: "没有检索到合适的，请调整选项。" });
      return;
    }
    setQuickOpen(false);
    onOpenPracticeSession(result.cards, result.messages);
  }

  function resetAndOpenQuick(): void {
    if (isSyncingPracticeDateKeys) {
      showDialogAfterInteractions({ message: "正在同步练习日历，请稍后再试。" });
      return;
    }
    setRecentDays(7);
    setQuickLimit(10);
    setBand("any");
    setQuickOpen(true);
  }

  async function syncPracticeMonthDateKeys(cursor: Date, options?: { force?: boolean }): Promise<void> {
    const { monthKey, fromDateKey, toDateKey: monthEndDateKey } = getMonthRange(cursor);
    const contactIds = PRACTICE_CONTACTS.map((contact) => contact.id);
    const cacheKey = getPracticeMonthCacheKey(monthKey, contactIds);

    if (!(await hasLocalProAccess())) {
      if (isMounted()) setPracticeDayStats(new Map());
      return;
    }

    const cachedStats = options?.force ? null : getCachedPracticeMonthStats(cacheKey, monthKey);
    if (cachedStats) {
      mergePracticeDayStats(cachedStats);
      return;
    }
    if (!options?.force && loadedPracticeMonthKeysRef.current.has(monthKey)) {
      const loadedStats = getCachedPracticeMonthStats(cacheKey, monthKey);
      if (loadedStats) {
        mergePracticeDayStats(loadedStats);
        return;
      }
    }
    loadedPracticeMonthKeysRef.current.add(monthKey);
    // 月视图只同步按 dateKey 聚合后的练习正确率；进入某天练习时再拉消息。
    const { token, controller } = practiceMonthMachine.begin("practice_month", monthKey);
    setIsSyncingPracticeDateKeys(true);
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "calendar" as const,
      ...showNotice({
        message: "正在同步练习日历...",
        type: "info",
        position: "top-right",
        durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;

    try {
      practiceMonthMachine.setPhase(token, "fetching");
      const stats = await listPracticeDayStatsFromCloud({
        contactIds,
        fromDateKey,
        toDateKey: monthEndDateKey,
        signal: controller.signal,
      });
      practiceMonthMachine.setPhase(token, "merging");
      if (!isMounted()) return;
      mergePracticeDayStats(stats);
      setCachedPracticeMonthStats(cacheKey, stats);
      clearPracticeStatsDirtyForMonth(monthKey);
      notice.hide();
    } catch (error) {
      if (controller.signal.aborted) {
        loadedPracticeMonthKeysRef.current.delete(monthKey);
        notice.hide();
        return;
      }
      if (isCloudAccessDeniedError(error)) {
        loadedPracticeMonthKeysRef.current.delete(monthKey);
        setPracticeDayStats(new Map());
        notice.hide();
        return;
      }
      loadedPracticeMonthKeysRef.current.delete(monthKey);
      notice.update({
        message: "同步失败，稍后再试",
        type: "warning",
        durationMs: 2200,
      });
    } finally {
      // 切换月份会 abort 上一次同步；旧请求收尾时不能关闭新请求的转圈提示/禁点状态。
      if (isMounted()) setIsSyncingPracticeDateKeys(false);
      if (syncNoticeRef.current === notice) {
        syncNoticeRef.current = null;
      }
      practiceMonthMachine.setPhase(token, "settling");
      practiceMonthMachine.settle(token);
    }
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
              const stats = localDayStats.get(key);
              const isCurrentMonth = cell.date.getMonth() === monthCursor.getMonth();
              const enabled = isCurrentMonth && !!stats;
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

// 本地桶仍是练习入口的基础快照；免费用户完全依赖这里，Pro 用户再叠加云端聚合 stats。
async function loadPracticeMessagesFromLocal(): Promise<{ rows: ChatMessage[]; contactMap: Map<string, ChatContact> }> {
  const chunks = await Promise.all(PRACTICE_CONTACTS.map(async (contact) => {
    return {
      contact,
      rows: await loadPracticeLocalMessages(contact.id),
    };
  }));
  const contactMap = new Map<string, ChatContact>();
  const rows = chunks
    .flatMap((chunk) => {
      chunk.rows.forEach((row) => contactMap.set(getMessageIdentityKey(row), chunk.contact));
      return chunk.rows;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { rows, contactMap };
}

function isCloudAccessDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("pro access required") || message.includes("unauthorized");
}

async function loadPracticeMessagesFromCloudByDateKeys(
  dateKeys: string[],
  signal?: AbortSignal
): Promise<{ rows: ChatMessage[]; contactMap: Map<string, ChatContact> }> {
  const session = await getSession();
  const userId = session?.user?.id ?? "mock_user_001";
  const chunks = await Promise.all(PRACTICE_CONTACTS.flatMap((contact) =>
    dateKeys.map(async (dateKey) => {
      const conversationId = await findConversationIdByDateFromCloud({ contactId: contact.id, dateKey, signal });
      if (!conversationId) return { contact, rows: [] as ChatMessage[] };
      const rows = await listDayMessagesFromCloud({ conversationId, userId, dateKey, signal });
      return {
        contact,
        rows: rows.map(mapCloudMessage),
      };
    })
  ));
  const contactMap = new Map<string, ChatContact>();
  const rows = chunks
    .flatMap((chunk) => {
      chunk.rows.forEach((row) => contactMap.set(getMessageIdentityKey(row), chunk.contact));
      return chunk.rows;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return { rows, contactMap };
}

function collectRecentPracticeDateKeys(recentDays: number, todayDateKey: string): string[] {
  const keys: string[] = [];
  const today = dateKeyToDate(todayDateKey);
  for (let offset = 0; offset < recentDays; offset += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    keys.push(toDateKey(d));
  }
  return keys;
}

function mapCloudMessage(row: MessageView): ChatMessage {
  return {
    id: row.id,
    localId: `cloud-${row.id}`,
    clientId: `cloud-${row.id}`,
    serverId: row.id,
    role: row.role,
    text: row.content,
    time: new Date(row.createdAt).toTimeString().slice(0, 5),
    createdAt: row.createdAt,
    conversationDateKey: row.conversationDateKey ?? null,
    status: row.status,
    clozeState: row.clozeState ?? null,
    clozeVersion: row.clozeVersion ?? 0,
    clozePracticeDiscardedAt: row.clozePracticeDiscardedAt ?? null,
  };
}

function mergePracticeMessages(
  leftRows: ChatMessage[],
  leftMap: Map<string, ChatContact>,
  rightRows: ChatMessage[],
  rightMap: Map<string, ChatContact>
): { rows: ChatMessage[]; contactMap: Map<string, ChatContact> } {
  const byKey = new Map<string, ChatMessage>();
  for (const row of [...leftRows, ...rightRows]) {
    byKey.set(getMessageIdentityKey(row), row);
  }
  const contactMap = mergeContactMaps(leftMap, rightMap);
  return {
    rows: Array.from(byKey.values()).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    contactMap,
  };
}

function mergeContactMaps(left: Map<string, ChatContact>, right: Map<string, ChatContact>): Map<string, ChatContact> {
  const next = new Map(left);
  right.forEach((contact, messageId) => next.set(messageId, contact));
  return next;
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
  if (!props.visible) return null;

  return (
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

function getMonthRange(cursor: Date): { monthKey: string; fromDateKey: string; toDateKey: string } {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return {
    monthKey: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    fromDateKey: toDateKey(firstDay),
    toDateKey: toDateKey(lastDay),
  };
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
    backgroundColor: "#E8F1E8",
  },
  dayBubbleMid: {
    backgroundColor: "#BFDDBF",
  },
  dayBubbleHigh: {
    backgroundColor: "#6DAE75",
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
    ...StyleSheet.absoluteFillObject,
    zIndex: 998,
    elevation: 998,
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
