import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  ToastAndroid,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allLocalMessages, setAllLocalMessages] = useState<ChatMessage[]>([]);
  const [dayMessages, setDayMessages] = useState<ChatMessage[]>([]);
  const [cloudDateKeys, setCloudDateKeys] = useState<Set<string>>(new Set());
  const [autoCopyAfterRewrite, setAutoCopyAfterRewrite] = useState(true);
  const [remainingChars, setRemainingChars] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const allLocalMessagesRef = useRef<ChatMessage[]>([]);
  const messageListRef = useRef<FlatList<any> | null>(null);
  const selectedDateKeyRef = useRef(toDateKey(new Date()));
  const dayLoadedRowsRef = useRef<Record<string, ChatMessage[]>>({});
  const syncSeqRef = useRef(0);
  const latestSyncReqByDateRef = useRef<Record<string, number>>({});
  const scrollToBottom = React.useCallback((animated = false): void => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated });
    });
  }, []);
  const canSend = useMemo(() => {
    const hasQuota = remainingChars === null ? true : remainingChars > 0;
    return inputText.trim().length > 0 && !isSending && hasQuota;
  }, [inputText, isSending, remainingChars]);

  useEffect(() => {
    allLocalMessagesRef.current = allLocalMessages;
  }, [allLocalMessages]);

  useEffect(() => {
    selectedDateKeyRef.current = toDateKey(selectedDate);
  }, [selectedDate]);

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
      // Session-level monotonic cache: once a day's rows are seen, keep them as the floor in this app run.
      const grouped: Record<string, ChatMessage[]> = {};
      for (const row of rows) {
        const key = toDateKey(new Date(row.createdAt));
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
      }
      for (const [key, dayRows] of Object.entries(grouped)) {
        const normalized = toDisplayRows(dayRows).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        const existing = dayLoadedRowsRef.current[key] ?? [];
        if (normalized.length > existing.length) {
          dayLoadedRowsRef.current[key] = normalized;
        }
      }
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
    });
  }, [selectedDate]);

  useEffect(() => {
    const onKeyboardShow = (event: any) => {
      const height = Math.max(0, event.endCoordinates?.height ?? 0);
      setKeyboardInset(height);
      scrollToBottom(false);
      setTimeout(() => scrollToBottom(false), 32);
    };
    const onKeyboardHide = () => {
      setKeyboardInset(0);
      scrollToBottom(false);
      setTimeout(() => scrollToBottom(false), 32);
    };
    const showSub = Keyboard.addListener("keyboardDidShow", onKeyboardShow);
    const hideSub = Keyboard.addListener("keyboardDidHide", onKeyboardHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    if (keyboardInset <= 0) return;
    const timer = setTimeout(() => {
      scrollToBottom(false);
    }, 48);
    return () => clearTimeout(timer);
  }, [keyboardInset, messages.length, scrollToBottom]);

  useEffect(() => {
    const today = new Date();
    setCloudDateKeys((prev) => {
      const next = new Set(prev);
      next.add("2026-05-14");
      next.add("2026-05-15");
      return next;
    });
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

  const handleCopyMessage = React.useCallback(
    (message: ChatMessage) => {
      void copyAssistantText(message.text);
    },
    []
  );

  const handleScrollBeginDrag = React.useCallback(() => {
    Keyboard.dismiss();
  }, []);

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
    if (isSameDate(selectedDate, now)) {
      scrollToBottom(false);
      return;
    }
    setSelectedDate(now);
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    const byDay = toDisplayRows(filterByDate(allLocalMessagesRef.current, now));
    setDayMessages(byDay);
    setMessages(byDay);
    scrollToBottom(false);
  }

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

  async function syncDayFromCloud(
    d: Date,
    options?: { force?: boolean }
  ): Promise<void> {
    const [session, entitlement] = await Promise.all([
      getSession(),
      getCurrentEntitlement().catch(() => null),
    ]);
    const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";
    const isPro = entitlement?.isPro === true;
    const dateKey = toDateKey(d);
    const reqId = ++syncSeqRef.current;
    latestSyncReqByDateRef.current[dateKey] = reqId;

    if (!isPro) return;

    const resolvedConversationId = await resolveConversationIdForDate(dateKey);
    if (!resolvedConversationId) return;

    // Dumb-and-stable mode: load full day in one request and overwrite local day cache.
    const allRows: Awaited<ReturnType<typeof listDayMessagesPageFromCloud>>["items"] = [];
    let cursor: DayPageCursor | null = null;
    while (true) {
      const page = await listDayMessagesPageFromCloud({
        conversationId: resolvedConversationId,
        dateKey,
        limit: 200,
        cursor,
      });
      if (latestSyncReqByDateRef.current[dateKey] !== reqId) return;
      allRows.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (allRows.length > 5000) break;
    }

    const visibleMapped = toDisplayRows(mapCloudRows(allRows)).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    setCloudDateKeys((prev) => {
      const next = new Set(prev);
      next.add(dateKey);
      return next;
    });

    const dayKey = toDateKey(d);
    const baseRows = allLocalMessagesRef.current.filter((row) => {
      return toDateKey(new Date(row.createdAt)) !== dayKey;
    });
    const cachedLoaded = (dayLoadedRowsRef.current[dayKey] ?? []).slice().sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    let nextVisibleDay = visibleMapped;
    if (!options?.force && nextVisibleDay.length < cachedLoaded.length) {
      nextVisibleDay = cachedLoaded;
    }
    dayLoadedRowsRef.current[dayKey] = nextVisibleDay;

    const replaced = [...baseRows, ...nextVisibleDay].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    setAllLocalMessages(replaced);
    allLocalMessagesRef.current = replaced;
    await replaceRewriteMessages(replaced);
    if (selectedDateKeyRef.current === dayKey) {
      setDayMessages(nextVisibleDay);
      setMessages(nextVisibleDay);
    }
  }

  async function handleSelectDate(d: Date): Promise<void> {
    Keyboard.dismiss();
    setSelectedDate(d);
    setIsDateSheetOpen(false);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));

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
      <View style={[styles.content, { paddingBottom: keyboardInset }]}>
        <ChatHeader
          onBack={onBack}
          onOpenCalendar={() => setIsDateSheetOpen(true)}
          onOpenMenu={handleOpenMenu}
        />

        <MessageList
          messages={messages}
          selectedDateLabel={selectedDateLabelText(selectedDate)}
          listRef={messageListRef}
          onScrollBeginDrag={handleScrollBeginDrag}
          onRetryMessage={handleRetryMessage}
          onCopyMessage={handleCopyMessage}
        />

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
      </View>

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
