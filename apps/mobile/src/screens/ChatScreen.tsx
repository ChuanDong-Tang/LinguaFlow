import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import { listMessagesByRangeFromCloud } from "../services/chatHistoryApi";
import { createLocalRewritePair } from "../services/chatSyncService";
import {
  appendRewriteMessages,
  ensureRewriteMessagesLoaded,
  replaceRewriteMessages,
  startRewriteSession,
  stopRewriteSession,
  subscribeRewriteSession,
  updateRewriteMessage,
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
  getVisibleWindow,
  isSameDate,
  mergeByLocalId,
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
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoadingNewer, setIsLoadingNewer] = useState(false);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allLocalMessages, setAllLocalMessages] = useState<ChatMessage[]>([]);
  const [dayMessages, setDayMessages] = useState<ChatMessage[]>([]);
  const [windowStart, setWindowStart] = useState(0);
  const [windowEnd, setWindowEnd] = useState(0);
  const [cloudDateKeys, setCloudDateKeys] = useState<Set<string>>(new Set());
  const [autoCopyAfterRewrite, setAutoCopyAfterRewrite] = useState(true);

  const scrollRef = useRef<ScrollView>(null);
  const canSend = useMemo(() => inputText.trim().length > 0 && !isSending, [inputText, isSending]);

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
    async function bootstrapLocal() {
      const rows = await ensureRewriteMessagesLoaded();
      if (cancelled) return;
      setAllLocalMessages(rows);
      const byDay = filterByDate(rows, selectedDate);
      setDayMessages(byDay);
      const { start, end, items } = getVisibleWindow(byDay);
      setWindowStart(start);
      setWindowEnd(end);
      setMessages(items);
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
      const byDay = filterByDate(rows, selectedDate);
      setDayMessages(byDay);
      const { start, end, items } = getVisibleWindow(byDay);
      setWindowStart(start);
      setWindowEnd(end);
      setMessages(items);
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 60);
    });
  }, [selectedDate]);

  useEffect(() => {
    if (!conversationId) return;
    const safeConversationId: string = conversationId;
    let cancelled = false;

    async function loadHistory() {
      try {
        const [session, entitlement] = await Promise.all([
          getSession(),
          getCurrentEntitlement().catch(() => null),
        ]);
        const isPro = entitlement?.isPro ?? session?.sessionFlags?.isPro === true;
        const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";

        if (!isPro) {
          setCloudDateKeys(new Set());
          return;
        }

        // 1) 拉近30天日期键，用于日历可选状态（范围拉取）
        const now = new Date();
        const from30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        const rangeRows = await listMessagesByRangeFromCloud({
          conversationId: safeConversationId,
          userId,
          fromDateKey: toDateKey(from30),
          toDateKey: toDateKey(now),
        });
        if (cancelled) return;
        const set = new Set<string>();
        for (const r of rangeRows) set.add(toDateKey(new Date(r.createdAt)));
        setCloudDateKeys(set);

        // 2) 当前选中日期：本地优先；本地没有时再云端补一天
        const localRows = filterByDate(allLocalMessages, selectedDate);
        if (localRows.length > 0) {
          return;
        }

        setIsLoadingHistory(true);
        const dateKey = toDateKey(selectedDate);
        const dayRows = await listMessagesByRangeFromCloud({
          conversationId: safeConversationId,
          userId,
          fromDateKey: dateKey,
          toDateKey: dateKey,
        });
        if (cancelled) return;
        const mappedDay: ChatMessage[] = dayRows.map((row) => ({
          id: row.id,
          localId: row.id,
          role: row.role,
          text: row.content,
          time: new Date(row.createdAt).toTimeString().slice(0, 5),
          createdAt: row.createdAt,
          status: row.status,
        }));

        if (mappedDay.length > 0) {
          const merged = mergeByLocalId(allLocalMessages, mappedDay);
          setAllLocalMessages(merged);
          await replaceRewriteMessages(merged);
          setDayMessages(mappedDay);
          const { start, end, items } = getVisibleWindow(mappedDay);
          setWindowStart(start);
          setWindowEnd(end);
          setMessages(items);
        }
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [conversationId, selectedDate]);

  function updateLocalMessage(
    localId: string,
    updater: (message: ChatMessage) => ChatMessage
  ): void {
    updateRewriteMessage(localId, updater);
  }

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

    const now = new Date();
    const isViewingToday = isSameDate(selectedDate, now);
    const baseMessages = isViewingToday ? dayMessages : filterByDate(allLocalMessages, now);

    if (!isViewingToday) {
      setSelectedDate(now);
      setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    }

    setInputText("");
    setIsSending(true);

    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalRewritePair(text, now);
    const localNext = [...(isViewingToday ? baseMessages : filterByDate(allLocalMessages, now)), userLocal, assistantLocal];
    setDayMessages(localNext);
    const endInit = localNext.length;
    const startInit = Math.max(0, endInit - 120);
    setWindowStart(startInit);
    setWindowEnd(endInit);
    setMessages(localNext.slice(startInit, endInit));
    const allNext = await appendRewriteMessages([userLocal, assistantLocal]);
    setAllLocalMessages(allNext);

    startRewriteSession({
      text,
      userLocalId: userLocal.localId,
      assistantLocalId: assistantLocal.localId,
      retryCount: 0,
      conversationId,
      autoCopyAfterRewrite,
      onSuccessText: (assistantText) => copyAssistantText(assistantText, true),
    });
  }

  async function handleRetryMessage(message: ChatMessage): Promise<void> {
    const text = message.retryText?.trim();
    if (!text || isSending || (message.retryCount ?? 0) >= 1) return;

    setIsSending(true);
    const retryCount = (message.retryCount ?? 0) + 1;
    updateLocalMessage(message.localId, (row) => ({
      ...row,
      text: "",
      status: "pending",
      retryCount,
      createdAt: new Date().toISOString(),
    }));

    startRewriteSession({
      text,
      assistantLocalId: message.localId,
      retryCount,
      systemPrompt: message.retrySystemPrompt,
      conversationId,
      autoCopyAfterRewrite,
      onSuccessText: (assistantText) => copyAssistantText(assistantText, true),
    });
  }

  function handleStopGenerating(): void {
    stopRewriteSession();
  }

  function handleComposerFocus(): void {
    const now = new Date();
    if (isSameDate(selectedDate, now)) return;
    setSelectedDate(now);
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    const byDay = filterByDate(allLocalMessages, now);
    setDayMessages(byDay);
    const { start, end, items } = getVisibleWindow(byDay);
    setWindowStart(start);
    setWindowEnd(end);
    setMessages(items);
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
  }

  function handleReachTop(): void {
    if (isLoadingOlder) return;
    if (windowStart <= 0) return; // 到上限直接无反应
    setIsLoadingOlder(true);
    const nextStart = Math.max(0, windowStart - 30);
    const nextEnd = Math.min(dayMessages.length, nextStart + 120);
    setWindowStart(nextStart);
    setWindowEnd(nextEnd);
    setMessages(dayMessages.slice(nextStart, nextEnd));
    setTimeout(() => setIsLoadingOlder(false), 120);
  }

  function handleReachBottom(): void {
    if (isLoadingNewer) return;
    if (windowEnd >= dayMessages.length) return; // 到上限直接无反应
    setIsLoadingNewer(true);
    const nextEnd = Math.min(dayMessages.length, windowEnd + 30);
    const nextStart = Math.max(0, nextEnd - 120);
    setWindowStart(nextStart);
    setWindowEnd(nextEnd);
    setMessages(dayMessages.slice(nextStart, nextEnd));
    setTimeout(() => setIsLoadingNewer(false), 120);
  }

  function selectedDateLabelText(d: Date): string {
    const today = new Date();
    if (isSameDate(d, today)) return "今天";
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  async function handleSelectDate(d: Date): Promise<void> {
    setSelectedDate(d);
    setIsDateSheetOpen(false);

    const localRows = filterByDate(allLocalMessages, d);
    if (localRows.length > 0) {
      setDayMessages(localRows);
      const { start, end, items } = getVisibleWindow(localRows);
      setWindowStart(start);
      setWindowEnd(end);
      setMessages(items);
      return;
    }

    if (!conversationId) return;

    try {
      setIsLoadingHistory(true);
      const [session, entitlement] = await Promise.all([
        getSession(),
        getCurrentEntitlement().catch(() => null),
      ]);
      const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";
      const dateKey = toDateKey(d);

      const cloudRows = await listMessagesByRangeFromCloud({
        conversationId,
        userId,
        fromDateKey: dateKey,
        toDateKey: dateKey,
      });

      if (cloudRows.length === 0) return;

      const mapped: ChatMessage[] = cloudRows.map((row) => ({
        id: row.id,
        localId: row.id,
        role: row.role,
        text: row.content,
        time: new Date(row.createdAt).toTimeString().slice(0, 5),
        createdAt: row.createdAt,
        status: row.status,
      }));

      const merged = mergeByLocalId(allLocalMessages, mapped);
      setAllLocalMessages(merged);
      await replaceRewriteMessages(merged);
      setDayMessages(mapped);
      const { start, end, items } = getVisibleWindow(mapped);
      setWindowStart(start);
      setWindowEnd(end);
      setMessages(items);
    } finally {
      setIsLoadingHistory(false);
    }
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
          isLoadingOlder={isLoadingOlder}
          isLoadingNewer={isLoadingNewer}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  content: {
    flex: 1,
  },
});
