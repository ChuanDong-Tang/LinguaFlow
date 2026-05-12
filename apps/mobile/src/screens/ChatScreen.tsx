import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  ToastAndroid,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { getSession } from "../services/authStorage";
import { getCurrentEntitlement } from "../services/meApi";
import {
  findConversationIdByDateFromCloud,
  listDayMessagesPageFromCloud,
  type DayPageCursor,
} from "../services/chatHistoryApi";
import { createLocalRewritePair } from "../services/chatSyncService";
import {
  appendRewriteMessages,
  ensureRewriteMessagesLoaded,
  replaceRewriteMessages,
  startRewriteSession,
  stopRewriteSession,
  subscribeRewriteSession,
} from "../services/rewriteSessionService";
import {
  loadAssistantPreferences,
  saveAssistantPreferences,
} from "../services/assistantPreferences";
import { copyTextToClipboard } from "../services/clipboardService";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatComposer } from "./chat/ChatComposer";
import { MessageList } from "./chat/MessageList";
import { DatePickerSheet } from "./chat/DatePickerSheet";
import type { ChatMessage } from "./chat/types";
import {
  filterByDate,
  isSameDate,
  toDateKey,
} from "./chat/messageState";

type ChatScreenProps = {
  onBack: () => void;
};

export function ChatScreen({ onBack }: ChatScreenProps) {
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allLocalMessages, setAllLocalMessages] = useState<ChatMessage[]>([]);
  const [dayMessages, setDayMessages] = useState<ChatMessage[]>([]);
  const [cloudDateKeys, setCloudDateKeys] = useState<Set<string>>(new Set());
  const [autoCopyAfterRewrite, setAutoCopyAfterRewrite] = useState(true);
  const [remainingChars, setRemainingChars] = useState<number | null>(null);
  const allLocalMessagesRef = useRef<ChatMessage[]>([]);
  const dayCursorRef = useRef<Record<string, DayPageCursor | null>>({});
  const dayHasMoreRef = useRef<Record<string, boolean>>({});
  const syncSeqRef = useRef(0);
  const latestSyncReqByDateRef = useRef<Record<string, number>>({});

  const scrollRef = useRef<ScrollView>(null);
  const lastAutoScrollAtRef = useRef(0);
  const pendingAutoScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleScrollToEnd(animated = true): void {
    const THROTTLE_MS = 120;
    const now = Date.now();
    const elapsed = now - lastAutoScrollAtRef.current;
    const doScroll = () => {
      lastAutoScrollAtRef.current = Date.now();
      scrollRef.current?.scrollToEnd({ animated });
    };

    if (elapsed >= THROTTLE_MS) {
      if (pendingAutoScrollRef.current) {
        clearTimeout(pendingAutoScrollRef.current);
        pendingAutoScrollRef.current = null;
      }
      doScroll();
      return;
    }

    if (pendingAutoScrollRef.current) return;
    pendingAutoScrollRef.current = setTimeout(() => {
      pendingAutoScrollRef.current = null;
      doScroll();
    }, THROTTLE_MS - elapsed);
  }
  const canSend = useMemo(() => {
    const hasQuota = remainingChars === null ? true : remainingChars > 0;
    return inputText.trim().length > 0 && !isSending && hasQuota;
  }, [inputText, isSending, remainingChars]);
  const selectedDateKey = useMemo(() => toDateKey(selectedDate), [selectedDate]);
  const showCenterLoading = useMemo(
    () => isLoadingHistory && dayMessages.length === 0,
    [isLoadingHistory, dayMessages.length]
  );

  useEffect(() => {
    allLocalMessagesRef.current = allLocalMessages;
  }, [allLocalMessages]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrapPreferences() {
      const preferences = await loadAssistantPreferences();
      if (!cancelled) setAutoCopyAfterRewrite(preferences.autoCopyAfterRewrite);
    }
    void bootstrapPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadEntitlementSnapshot() {
      const entitlement = await getCurrentEntitlement().catch(() => null);
      if (!cancelled) {
        setRemainingChars(entitlement?.remainingChars ?? null);
      }
    }
    void loadEntitlementSnapshot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrapLocal() {
      const rows = await ensureRewriteMessagesLoaded();
      if (cancelled) return;
      setAllLocalMessages(rows);
      allLocalMessagesRef.current = rows;
      const byDay = toDisplayRows(filterByDate(rows, selectedDate));
      setDayMessages(byDay);
      setMessages(byDay);
    }
    void bootstrapLocal();
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  useEffect(() => {
    return subscribeRewriteSession((snapshot) => {
      setIsSending(snapshot.isSending);
      if (snapshot.conversationId) setConversationId(snapshot.conversationId);

      const rows = snapshot.messages;
      if (rows.length === 0) return;

      setAllLocalMessages(rows);
      allLocalMessagesRef.current = rows;
      const byDay = toDisplayRows(filterByDate(rows, selectedDate));
      setDayMessages(byDay);
      setMessages(byDay);
      scheduleScrollToEnd(true);
    });
  }, [selectedDate]);

  useEffect(() => {
    return () => {
      if (pendingAutoScrollRef.current) {
        clearTimeout(pendingAutoScrollRef.current);
        pendingAutoScrollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const today = new Date();
    const todayKey = toDateKey(today);
    dayCursorRef.current[todayKey] = null;
    dayHasMoreRef.current[todayKey] = true;
    void syncDayFromCloud(today);
  }, []);

  async function copyAssistantText(text: string, silent = false): Promise<void> {
    try {
      const ok = await copyTextToClipboard(text);
      if (ok) {
        notifyCopySuccess(silent ? "已自动复制" : "已复制");
      } else if (!silent) {
        Alert.alert("没有可复制的内容");
      }
    } catch {
      Alert.alert("复制失败", "请稍后重试，或手动选择内容复制。");
    }
  }

  function notifyCopySuccess(message: string): void {
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    if (!message.includes("自动")) {
      Alert.alert(message);
    }
  }

  async function handleToggleAutoCopy(): Promise<void> {
    const next = !autoCopyAfterRewrite;
    setAutoCopyAfterRewrite(next);
    await saveAssistantPreferences({ autoCopyAfterRewrite: next });
    Alert.alert(next ? "自动复制已开启" : "自动复制已关闭");
  }

  function handleOpenMenu(): void {
    Alert.alert("聊天设置", autoCopyAfterRewrite ? "自动复制已开启" : "自动复制已关闭", [
      {
        text: autoCopyAfterRewrite ? "关闭自动复制" : "开启自动复制",
        onPress: () => {
          void handleToggleAutoCopy();
        },
      },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || isSending) return;
    if (remainingChars !== null && remainingChars <= 0) {
      Alert.alert("You've reached your daily quota.");
      return;
    }

    const now = new Date();
    const isViewingToday = isSameDate(selectedDate, now);

    if (!isViewingToday) {
      setSelectedDate(now);
      setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    }

    setInputText("");
    Keyboard.dismiss();
    setIsSending(true);

    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalRewritePair(text, now);
    const localNextRaw = [...(isViewingToday ? dayMessages : toDisplayRows(filterByDate(allLocalMessagesRef.current, now))), userLocal, assistantLocal];
    const localNext = toDisplayRows(localNextRaw);
    setDayMessages(localNext);
    setMessages(localNext);
    const allNext = await appendRewriteMessages([userLocal, assistantLocal]);
    setAllLocalMessages(allNext);
    allLocalMessagesRef.current = allNext;

    startRewriteSession({
      text,
      userLocalId: userLocal.localId,
      assistantLocalId: assistantLocal.localId,
      retryCount: 0,
      conversationId,
      autoCopyAfterRewrite,
      onSuccessText: (assistantText) => copyAssistantText(assistantText, true),
    });

    const entitlement = await getCurrentEntitlement().catch(() => null);
    setRemainingChars(entitlement?.remainingChars ?? null);
  }

  async function handleRetryMessage(message: ChatMessage): Promise<void> {
    const text = message.retryText?.trim();
    if (!text || isSending || (message.retryCount ?? 0) >= 1) return;
    if (remainingChars !== null && remainingChars <= 0) {
      Alert.alert("You've reached your daily quota.");
      return;
    }

    Keyboard.dismiss();
    setIsSending(true);
    const now = new Date();
    const retryCount = (message.retryCount ?? 0) + 1;
    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalRewritePair(text, now);
    const localNext = [...dayMessages, userLocal, assistantLocal];
    setDayMessages(localNext);
    setMessages(toDisplayRows(localNext));
    const allNext = await appendRewriteMessages([userLocal, assistantLocal]);
    setAllLocalMessages(allNext);
    allLocalMessagesRef.current = allNext;

    startRewriteSession({
      text,
      userLocalId: userLocal.localId,
      assistantLocalId: assistantLocal.localId,
      retryCount,
      systemPrompt: message.retrySystemPrompt,
      conversationId,
      autoCopyAfterRewrite,
      onSuccessText: (assistantText) => copyAssistantText(assistantText, true),
    });

    const entitlement = await getCurrentEntitlement().catch(() => null);
    setRemainingChars(entitlement?.remainingChars ?? null);
  }

  function handleStopGenerating(): void {
    stopRewriteSession();
  }

  function handleComposerFocus(): void {
    const now = new Date();
    if (isSameDate(selectedDate, now)) return;
    setSelectedDate(now);
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    const byDay = toDisplayRows(filterByDate(allLocalMessagesRef.current, now));
    setDayMessages(byDay);
    setMessages(byDay);
    scheduleScrollToEnd(true);
  }

  function handleReachTop(): void {
    if (isLoadingHistory || isLoadingMore) return;
    if (dayHasMoreRef.current[selectedDateKey] === false) return;
    void syncDayFromCloud(selectedDate, { loadMore: true });
  }

  function handleReachBottom(): void {}

  function selectedDateLabelText(d: Date): string {
    const today = new Date();
    if (isSameDate(d, today)) return "今天";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  async function resolveConversationIdForDate(dateKey: string): Promise<string | null> {
    const resolved = await findConversationIdByDateFromCloud({
      dateKey,
      contactId: "rewrite_assistant",
    });
    const todayKey = toDateKey(new Date());
    const fallback = dateKey === todayKey ? conversationId : null;
    const finalId = resolved ?? fallback ?? null;
    if (finalId && finalId !== conversationId) {
      setConversationId(finalId);
    }
    return finalId;
  }

  function mapCloudRows(
    rows: Awaited<ReturnType<typeof listDayMessagesPageFromCloud>>["items"]
  ): ChatMessage[] {
    return rows.map((row) => ({
      id: row.id,
      localId: row.id,
      role: row.role,
      text: row.content,
      time: new Date(row.createdAt).toTimeString().slice(0, 5),
      createdAt: row.createdAt,
      status: row.status,
    }));
  }

  function isSameDayContent(localRows: ChatMessage[], cloudRows: ChatMessage[]): boolean {
    if (localRows.length !== cloudRows.length) return false;
    for (let i = 0; i < localRows.length; i += 1) {
      const l = localRows[i];
      const c = cloudRows[i];
      if (
        l.id !== c.id ||
        l.localId !== c.localId ||
        l.role !== c.role ||
        l.status !== c.status ||
        l.text !== c.text ||
        l.createdAt !== c.createdAt
      ) {
        return false;
      }
    }
    return true;
  }

  async function syncDayFromCloud(
    d: Date,
    options?: { loadMore?: boolean; force?: boolean }
  ): Promise<void> {
    try {
      const loadMore = options?.loadMore === true;
      if (loadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingHistory(true);
      }
      const [session, entitlement] = await Promise.all([
        getSession(),
        getCurrentEntitlement().catch(() => null),
      ]);
      const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";
      const isPro = entitlement?.isPro === true;
      const dateKey = toDateKey(d);
      const reqId = ++syncSeqRef.current;
      latestSyncReqByDateRef.current[dateKey] = reqId;

      if (!isPro) {
        dayHasMoreRef.current[dateKey] = false;
        return;
      }

      const resolvedConversationId = await resolveConversationIdForDate(dateKey);

      if (!resolvedConversationId) {
        dayHasMoreRef.current[dateKey] = false;
        return;
      }

      if (
        loadMore &&
        dayHasMoreRef.current[dateKey] === false &&
        !options?.force
      ) {
        return;
      }

      const cursor = loadMore ? dayCursorRef.current[dateKey] ?? null : null;
      const page = await listDayMessagesPageFromCloud({
        conversationId: resolvedConversationId,
        dateKey,
        limit: 30,
        cursor,
      });

      if (latestSyncReqByDateRef.current[dateKey] !== reqId) {
        return;
      }

      const mapped = mapCloudRows(page.items);
      const visibleMapped = toDisplayRows(mapped);
      dayCursorRef.current[dateKey] = page.nextCursor;
      dayHasMoreRef.current[dateKey] = page.nextCursor !== null;
      setCloudDateKeys((prev) => {
        const next = new Set(prev);
        next.add(dateKey);
        return next;
      });

      const dayKey = toDateKey(d);
      const baseRows = allLocalMessagesRef.current.filter((row) => {
        return toDateKey(new Date(row.createdAt)) !== dayKey;
      });
      const localDayRows = allLocalMessagesRef.current.filter((row) => {
        return toDateKey(new Date(row.createdAt)) === dayKey;
      });
      const localVisibleDay = toDisplayRows(localDayRows).sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : 1
      );
      const nextVisibleDay = loadMore
        ? toDisplayRows([...mapped, ...localVisibleDay]).sort((a, b) =>
            a.createdAt < b.createdAt ? -1 : 1
          )
        : visibleMapped.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

      if (!loadMore && !options?.force && isSameDayContent(localVisibleDay, nextVisibleDay)) {
        return;
      }

      const replaced = [...baseRows, ...nextVisibleDay].sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : 1
      );
      setAllLocalMessages(replaced);
      allLocalMessagesRef.current = replaced;
      await replaceRewriteMessages(replaced);
      setDayMessages(nextVisibleDay);
      setMessages(nextVisibleDay);
    } finally {
      if (options?.loadMore) {
        setIsLoadingMore(false);
      } else {
        setIsLoadingHistory(false);
      }
    }
  }

  async function handleSelectDate(d: Date): Promise<void> {
    setSelectedDate(d);
    setIsDateSheetOpen(false);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    const dateKey = toDateKey(d);
    dayCursorRef.current[dateKey] = null;
    dayHasMoreRef.current[dateKey] = true;

    const localRows = filterByDate(allLocalMessagesRef.current, d);
    const visibleLocalRows = toDisplayRows(localRows);
    if (visibleLocalRows.length > 0) {
      setDayMessages(visibleLocalRows);
      setMessages(visibleLocalRows);
    }

    await syncDayFromCloud(d);
  }

  const recordDateKeys = useMemo(() => {
    const set = new Set<string>();
    for (const row of allLocalMessages) {
      set.add(toDateKey(new Date(row.createdAt)));
    }
    for (const k of cloudDateKeys) set.add(k);
    return set;
  }, [allLocalMessages, cloudDateKeys]);

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={styles.content}>
        <ChatHeader
          onBack={onBack}
          onOpenCalendar={() => setIsDateSheetOpen(true)}
          onOpenMenu={handleOpenMenu}
        />

        <MessageList
          messages={messages}
          selectedDateLabel={selectedDateLabelText(selectedDate)}
          scrollRef={scrollRef}
          isLoadingHistory={isLoadingHistory}
          showCenterLoading={showCenterLoading}
          isLoadingOlder={isLoadingMore}
          isLoadingNewer={false}
          onReachTop={handleReachTop}
          onReachBottom={handleReachBottom}
          onRetryMessage={handleRetryMessage}
          onCopyMessage={(message) => copyAssistantText(message.text)}
        />

        <KeyboardStickyView offset={{ opened: 16, closed: 0 }}>
          <ChatComposer
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            onStop={handleStopGenerating}
            onFocus={handleComposerFocus}
            onDisabledPress={() => {
              if (remainingChars !== null && remainingChars <= 0) {
                Alert.alert("今日额度已用尽");
              }
            }}
            disabled={!canSend}
            isSending={isSending}
          />
        </KeyboardStickyView>
      </Animated.View>

      <DatePickerSheet
          visible={isDateSheetOpen}
          monthCursor={monthCursor}
          selectedDate={selectedDate}
          hasRecordDateKeys={recordDateKeys}
          onClose={() => setIsDateSheetOpen(false)}
        onPrevMonth={() =>
          setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
        }
        onNextMonth={() =>
          setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
        }
          onSelectDate={handleSelectDate}
      />
    </SafeAreaView>
  );
}

function toDisplayRows(rows: ChatMessage[]): ChatMessage[] {
  return rows.filter((row) => row.status === "success" || row.status === "pending");
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  content: {
    flex: 1,
  },
});
