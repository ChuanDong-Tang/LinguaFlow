import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { startRewriteStream } from "../services/chatStream";
import { getSession } from "../services/authStorage";
import { listMessagesByRangeFromCloud, sendMessageToCloud } from "../services/chatHistoryApi";
import { loadLocalMessages, saveLocalMessages } from "../services/chatLocalStorage";
import { loadDebugSettings } from "../services/debugSettingsStorage";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatComposer } from "./chat/ChatComposer";
import { MessageList } from "./chat/MessageList";
import { DatePickerSheet } from "./chat/DatePickerSheet";
import type { ChatMessage } from "./chat/types";
import {
  clampMessages,
  filterByDate,
  getVisibleWindow,
  isSameDate,
  mergeByLocalId,
  nowHHMM,
  toDateKey,
  updateMessageByLocalId,
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

  const scrollRef = useRef<ScrollView>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeAssistantLocalIdRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const canSend = useMemo(() => inputText.trim().length > 0 && !isSending, [inputText, isSending]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrapLocal() {
      const rows = await loadLocalMessages();
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
    if (!conversationId) return;
    const safeConversationId: string = conversationId;
    let cancelled = false;

    async function loadHistory() {
      try {
        const session = await getSession();
        const isPro = session?.sessionFlags?.isPro === true;
        const userId = session?.user?.id ?? "mock_user_001";

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
          await saveLocalMessages(merged);
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
    setMessages((prev) => updateMessageByLocalId(prev, localId, updater));
    setDayMessages((prev) => updateMessageByLocalId(prev, localId, updater));
    setAllLocalMessages((prev) => {
      const next = updateMessageByLocalId(prev, localId, updater);
      void saveLocalMessages(next);
      return next;
    });
  }

  async function runRewriteRequest(input: {
    text: string;
    assistantLocalId: string;
    retryCount: number;
    systemPrompt?: string;
    userLocalId?: string;
  }): Promise<void> {
    let requestSystemPrompt = input.systemPrompt;
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;
    activeAssistantLocalIdRef.current = input.assistantLocalId;
    stopRequestedRef.current = false;

    try {
      const session = await getSession();
      const userId = session?.user?.id ?? "mock_user_001";
      const debugSettings = await loadDebugSettings();
      requestSystemPrompt = input.systemPrompt ?? debugSettings.systemPrompt.trim();

      const cloud = await sendMessageToCloud({
        text: input.text,
        contactId: "rewrite_assistant",
      });
      const cloudConversationId = cloud.conversationId;
      const cloudUserMessageId = cloud.userMessage.id;

      if (!conversationId) setConversationId(cloud.conversationId);

      await startRewriteStream(
        {
          userId,
          text: input.text,
          conversationId: cloudConversationId,
          userMessageId: cloudUserMessageId,
          systemPrompt: requestSystemPrompt || undefined,
          signal: abortController.signal,
        },
        (event) => {
          if (event.type === "delta") {
            updateLocalMessage(input.assistantLocalId, (row) => ({
              ...row,
              text: row.text + event.text,
              createdAt: new Date().toISOString(),
            }));
          }

          if (event.type === "error") {
            if (input.userLocalId) {
              updateLocalMessage(input.userLocalId, (row) => ({ ...row, status: "failed" }));
            }
            updateLocalMessage(input.assistantLocalId, (row) => ({
              ...row,
              text: `[错误] ${event.message}`,
              status: "failed",
              retryText: input.text,
              retryCount: input.retryCount,
              retrySystemPrompt: requestSystemPrompt,
              createdAt: new Date().toISOString(),
            }));
          }

          if (event.type === "done") {
            if (input.userLocalId) {
              updateLocalMessage(input.userLocalId, (row) => ({ ...row, status: "success" }));
            }
            updateLocalMessage(input.assistantLocalId, (row) => ({
              ...row,
              status: "success",
              retryText: input.text,
              retryCount: input.retryCount,
              retrySystemPrompt: requestSystemPrompt,
              createdAt: new Date().toISOString(),
            }));
          }
        }
      );
    } catch (error) {
      const wasStopped = stopRequestedRef.current;
      const message = wasStopped ? "已停止生成" : error instanceof Error ? error.message : "stream failed";
      if (input.userLocalId) {
        updateLocalMessage(input.userLocalId, (row) => ({ ...row, status: "failed" }));
      }
      updateLocalMessage(input.assistantLocalId, (row) => ({
        ...row,
        text: `[错误] ${message}`,
        status: "failed",
        retryText: input.text,
        retryCount: input.retryCount,
        retrySystemPrompt: requestSystemPrompt,
        createdAt: new Date().toISOString(),
      }));
    } finally {
      activeAbortControllerRef.current = null;
      activeAssistantLocalIdRef.current = null;
      stopRequestedRef.current = false;
      setIsSending(false);
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 60);
    }
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

    const t = nowHHMM();
    const createdAt = new Date().toISOString();
    const userLocalId = `local-user-${Date.now()}`;
    const assistantLocalId = `local-assistant-${Date.now()}`;
    const userLocal: ChatMessage = {
      localId: userLocalId,
      role: "user",
      text,
      time: t,
      createdAt,
      status: "pending",
    };
    const assistantLocal: ChatMessage = {
      localId: assistantLocalId,
      role: "assistant",
      text: "",
      time: t,
      createdAt,
      status: "pending",
      retryText: text,
      retryCount: 0,
    };
    const localNext = [...(isViewingToday ? baseMessages : filterByDate(allLocalMessages, now)), userLocal, assistantLocal];
    setDayMessages(localNext);
    const endInit = localNext.length;
    const startInit = Math.max(0, endInit - 120);
    setWindowStart(startInit);
    setWindowEnd(endInit);
    setMessages(localNext.slice(startInit, endInit));
    const allNext = clampMessages([...allLocalMessages, userLocal, assistantLocal], 10000);
    setAllLocalMessages(allNext);
    await saveLocalMessages(allNext);

    await runRewriteRequest({
      text,
      userLocalId,
      assistantLocalId,
      retryCount: 0,
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

    await runRewriteRequest({
      text,
      assistantLocalId: message.localId,
      retryCount,
      systemPrompt: message.retrySystemPrompt,
    });
  }

  function handleStopGenerating(): void {
    if (!activeAbortControllerRef.current || !activeAssistantLocalIdRef.current) return;

    stopRequestedRef.current = true;
    activeAbortControllerRef.current.abort();
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
      const session = await getSession();
      const userId = session?.user?.id ?? "mock_user_001";
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
      await saveLocalMessages(merged);
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <ChatHeader onBack={onBack} onOpenCalendar={() => setIsDateSheetOpen(true)} />

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
        />

        <ChatComposer
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onStop={handleStopGenerating}
          onFocus={handleComposerFocus}
          disabled={!canSend}
          isSending={isSending}
        />
      </KeyboardAvoidingView>

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
});
