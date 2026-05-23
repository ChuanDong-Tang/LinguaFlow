import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession } from "../services/auth/authStorage";
import { getCurrentEntitlement } from "../services/api/meApi";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
import {
  findConversationIdByDateFromCloud,
  listConversationDateKeysFromCloud,
  listDayMessagesFromCloud,
} from "../services/api/chatHistoryApi";
import { createLocalChatPair } from "../services/chat/chatGenerationService";
import {
  appendChatMessages,
  listStoredChatDateKeys,
  loadChatMessagesByDate,
  replaceChatMessagesByDate,
  startChatSession,
  stopChatSession,
  subscribeChatGenerationActivity,
  subscribeChatSession,
} from "../services/chat/chatSessionService";
import { copyAssistantTaggedText } from "../services/chat/assistantCopyService";
import { getMonthRange, selectedDateLabelText } from "../services/chat/chatDateRange";
import { getChatGenerationInputLimits } from "../services/chat/chatInputLimits";
import { areMessageRowsEquivalent, toDisplayRows } from "../services/chat/chatMessageView";
import { useAssistantAutoCopyPreferences } from "../hooks/useAssistantAutoCopyPreferences";
import { useKeyboardAwareChatScroll } from "../hooks/useKeyboardAwareChatScroll";
import { useExclusiveSyncMachine } from "../hooks/useExclusiveSyncMachine";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatComposer } from "./chat/ChatComposer";
import { MessageList } from "./chat/MessageList";
import { DatePickerSheet } from "./chat/DatePickerSheet";
import {
  BlockingLoading,
  type BlockingLoadingOptions,
  runWithDeferredBlockingLoading,
} from "./shared/BlockingLoading";
import { useFloatingNotice } from "./shared/FloatingNotice";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import { ClozeControls } from "./chat/ClozeControls";
import type { ChatMessage } from "../domain/chat/types";
import { useChatClozeEditing } from "../hooks/useChatClozeEditing";
import {
  isSameDate,
  toDateKey,
} from "../domain/chat/messageState";
import type { ChatContact } from "../domain/chat/contacts";

type ChatScreenProps = {
  contact: ChatContact;
  onBack: () => void;
};

export function ChatScreen({ contact, onBack }: ChatScreenProps) {
  const { showNotice } = useFloatingNotice();
  const contactId = contact.id;
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeGenerationContactId, setActiveGenerationContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dayMessages, setDayMessages] = useState<ChatMessage[]>([]);
  const [localDateKeys, setLocalDateKeys] = useState<Set<string>>(new Set());
  const [cloudDateKeys, setCloudDateKeys] = useState<Set<string>>(new Set());
  const { autoCopyAfterGeneration, autoCopyMode, openAutoCopyMenu } = useAssistantAutoCopyPreferences();
  const [remainingChars, setRemainingChars] = useState<number | null>(null);
  const [isProEntitled, setIsProEntitled] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const [isTodaySyncing, setIsTodaySyncing] = useState(false);
  const [syncingDateKey, setSyncingDateKey] = useState<string | null>(null);
  const messageListRef = useRef<FlatList<any> | null>(null);
  const selectedDateKeyRef = useRef(toDateKey(new Date()));
  const dayLoadedRowsRef = useRef<Record<string, ChatMessage[]>>({});
  const syncSeqRef = useRef(0);
  const latestSyncReqByDateRef = useRef<Record<string, number>>({});
  const lastCloudSyncAtByDateRef = useRef<Record<string, number>>({});
  const loadedCloudMonthKeysRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const isProEntitledRef = useRef(false);
  const isTodaySyncingRef = useRef(false);
  const syncNoticeRef = useRef<{ hide: () => void; update: (next: any) => void; kind: "calendar" | "messages" | "cloze" } | null>(null);
  const daySyncMachine = useExclusiveSyncMachine<"chat_day">();
  const calendarSyncMachine = useExclusiveSyncMachine<"chat_calendar">();
  const clozeSaveMachine = useExclusiveSyncMachine<"cloze_save">();
  const scrollToBottom = React.useCallback((animated = false): void => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated });
    });
  }, []);
  const keyboardInset = useKeyboardAwareChatScroll(scrollToBottom, messages.length);
  const canSend = useMemo(() => {
    const hasQuota = remainingChars === null ? true : remainingChars > 0;
    const { min: minInputChars, max: maxInputChars } = getChatGenerationInputLimits();
    const inputLength = inputText.trim().length;
    return (
      !activeGenerationContactId &&
      !isTodaySyncing &&
      hasQuota &&
      inputLength >= minInputChars &&
      inputLength <= maxInputChars
    );
  }, [activeGenerationContactId, inputText, isTodaySyncing, remainingChars]);
  const selectedDateKey = toDateKey(selectedDate);
  const isSelectedDateSyncing = syncingDateKey === selectedDateKey;
  const isAnotherContactGenerating = !!activeGenerationContactId && activeGenerationContactId !== contactId;
  
  // 生命周期清理：退出聊天页时取消仍在进行的历史同步，并清掉全局轻提示
  useEffect(() => {
    return () => {
      // 页面退出时取消所有业务同步；页面内不同类型同步彼此独立，不在这里混成一条队列。
      isMountedRef.current = false;
      syncNoticeRef.current?.hide();
      syncNoticeRef.current = null;
      daySyncMachine.cancel();
      calendarSyncMachine.cancel();
      clozeSaveMachine.cancel();
    };
  }, []);

  // 同步回包时用它判断用户当前还停在哪一天。
  useEffect(() => {
    selectedDateKeyRef.current = toDateKey(selectedDate);
  }, [selectedDate]);

  // 填空保存等异步逻辑需要读取最新 Pro 状态。
  useEffect(() => {
    isProEntitledRef.current = isProEntitled;
  }, [isProEntitled]);

  // 发送入口用它即时判断今天同步锁，避免按钮状态刷新前抢发。
  useEffect(() => {
    isTodaySyncingRef.current = isTodaySyncing;
  }, [isTodaySyncing]);

  // 启动初始化：加载本地权益快照，用于额度和 Pro 历史同步开关。
  useEffect(() => {
    let cancelled = false;
    async function loadEntitlementSnapshot() {
      if (!(await hasLocalProAccess())) {
        if (!cancelled) {
          setRemainingChars(null);
          setIsProEntitled(false);
        }
        return;
      }
      const entitlement = await getCurrentEntitlement().catch(() => null);
      if (!cancelled) {
        setRemainingChars(entitlement?.remainingChars ?? null);
        setIsProEntitled(entitlement?.isPro === true);
      }
    }
    void loadEntitlementSnapshot();
    return () => {
      cancelled = true;
    };
  }, []);

  // 本地历史：按当前日期加载缓存，并建立本轮会话内的按天最小显示缓存。
  useEffect(() => {
    let cancelled = false;
    async function bootstrapLocal() {
      const storedDateKeys = await listStoredChatDateKeys(contactId);
      if (!cancelled) {
        setLocalDateKeys(new Set(storedDateKeys));
      }
      const byDay = toDisplayRows(await loadChatMessagesByDate(contactId, toDateKey(selectedDate)));
      if (cancelled) return;
      dayLoadedRowsRef.current[toDateKey(selectedDate)] = byDay;
      setDayMessages(byDay);
      setMessages(byDay);
    }
    void bootstrapLocal();
    return () => {
      cancelled = true;
    };
  }, [contactId, selectedDate]);

  // 生成会话订阅：接收流式改写状态和消息列表更新。
  useEffect(() => {
    return subscribeChatSession(contactId, (snapshot) => {
      setIsSending(snapshot.isSending);
      if (snapshot.conversationId) setConversationId(snapshot.conversationId);
      if (!snapshot.changedDateKey || snapshot.changedDateKey !== toDateKey(selectedDate)) return;
      void (async () => {
        const byDay = toDisplayRows(await loadChatMessagesByDate(contactId, toDateKey(selectedDate)));
        setDayMessages(byDay);
        setMessages(byDay);
      })();
    });
  }, [contactId, selectedDate]);

  useEffect(() => {
    return subscribeChatGenerationActivity((snapshot) => {
      setActiveGenerationContactId(snapshot.activeContactId);
    });
  }, []);

  // 启动同步：进入聊天页后静默同步今天，兼顾多端新增消息。
  useEffect(() => {
    const today = new Date();
    void syncDateQuietly(today, { force: true });
  }, []);

  // 日期面板：打开日历时预加载当前月份云端有记录的日期。
  useEffect(() => {
    if (!isDateSheetOpen) {
      return;
    }
    void preloadCloudMonthDateKeys(monthCursor);
  }, [isDateSheetOpen, monthCursor]);

  const handleCopyMessage = React.useCallback(
    (message: ChatMessage) => {
      void copyAssistantTaggedText(message.text, autoCopyMode);
    },
    [autoCopyMode]
  );

  const handleScrollBeginDrag = React.useCallback(() => {
    Keyboard.dismiss();
  }, []);

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || activeGenerationContactId) return;
    const { min: minInputChars, max: maxInputChars } = getChatGenerationInputLimits();
    if (text.length < minInputChars) {
      Alert.alert(`至少输入 ${minInputChars} 个字符`)
      return;
    }
    if (text.length > maxInputChars) {
      Alert.alert(`最多输入 ${maxInputChars} 个字符`)
      return;
    }
    if (isTodaySyncingRef.current) {
      Alert.alert("正在同步消息，请稍后发送")
      return;
    }
    if (remainingChars !== null && remainingChars <= 0) {
      Alert.alert("字符额度已用尽");
      return;
    }

    const now = new Date();
    const isViewingToday = isSameDate(selectedDate, now);

    if (!isViewingToday) {
      setSelectedDate(now);
      setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
      void (async () => {
        const byDay = toDisplayRows(await loadChatMessagesByDate(contactId, toDateKey(now)));
        setDayMessages(byDay);
        setMessages(byDay);
      })();
      void syncDateQuietly(now, { force: true });
      return;
    }

    setInputText("");
    Keyboard.dismiss();
    setIsSending(true);

    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalChatPair(text, now);
    const todayRows = isViewingToday ? dayMessages : toDisplayRows(await loadChatMessagesByDate(contactId, toDateKey(now)));
    const localNextRaw = [...todayRows, userLocal, assistantLocal];
    const localNext = toDisplayRows(localNextRaw);
    setDayMessages(localNext);
    setMessages(localNext);
    await appendChatMessages(contactId, [userLocal, assistantLocal]);
    setLocalDateKeys((prev) => new Set([...prev, toDateKey(now)]));

    startChatSession({
      contactId,
      text,
      userLocalId: userLocal.localId,
      assistantLocalId: assistantLocal.localId,
      conversationDateKey: toDateKey(now),
      retryCount: 0,
      conversationId,
      autoCopyAfterGeneration,
      autoCopyMode,
      onSuccessText: (assistantText, mode) => copyAssistantTaggedText(assistantText, mode, true),
    });

    if (await hasLocalProAccess()) {
      const entitlement = await getCurrentEntitlement().catch(() => null);
      setRemainingChars(entitlement?.remainingChars ?? null);
      setIsProEntitled(entitlement?.isPro === true);
    }
  }

  async function handleRetryMessage(message: ChatMessage): Promise<void> {
    const text = message.retryText?.trim();
    if (!text || activeGenerationContactId || (message.retryCount ?? 0) >= 1) return;
    if (remainingChars !== null && remainingChars <= 0) {
      Alert.alert("字符额度已用尽");
      return;
    }

    Keyboard.dismiss();
    setIsSending(true);
    const now = new Date();
    const retryCount = (message.retryCount ?? 0) + 1;
    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalChatPair(text, now);
    const localNext = [...dayMessages, userLocal, assistantLocal];
    setDayMessages(localNext);
    setMessages(toDisplayRows(localNext));
    const retryDateKey = message.conversationDateKey ?? toDateKey(now);
    await appendChatMessages(contactId, [userLocal, assistantLocal]);
    setLocalDateKeys((prev) => new Set([...prev, retryDateKey]));

    startChatSession({
      contactId,
      text,
      userLocalId: userLocal.localId,
      assistantLocalId: assistantLocal.localId,
      conversationDateKey: retryDateKey,
      retryCount,
      systemPrompt: message.retrySystemPrompt,
      conversationId,
      autoCopyAfterGeneration,
      autoCopyMode,
      onSuccessText: (assistantText, mode) => copyAssistantTaggedText(assistantText, mode, true),
    });

    if (await hasLocalProAccess()) {
      const entitlement = await getCurrentEntitlement().catch(() => null);
      setRemainingChars(entitlement?.remainingChars ?? null);
      setIsProEntitled(entitlement?.isPro === true);
    }
  }

  function handleStopGenerating(): void {
    stopChatSession(contactId);
  }

  function handleComposerFocus(): void {
    const now = new Date();
    if (isSameDate(selectedDate, now)) {
      scrollToBottom(false);
      return;
    }
    setSelectedDate(now);
    setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    void (async () => {
      const byDay = toDisplayRows(await loadChatMessagesByDate(contactId, toDateKey(now)));
      setDayMessages(byDay);
      setMessages(byDay);
    })();
    scrollToBottom(false);
  }

  async function preloadCloudMonthDateKeys(cursor: Date): Promise<void> {
    if (!(await hasLocalProAccess())) return;

    const { monthKey, fromDateKey, toDateKey: monthEndDateKey } = getMonthRange(cursor);
    // 月索引和 day 同步是两条业务线，但 notice 仍共用一个入口，后来的提示会顶掉前面的。
    const { token, controller } = calendarSyncMachine.begin("chat_calendar", monthKey);
    // 日历同步只顶掉上一轮日历同步；notice 单通道另行处理，不取消消息同步。
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "calendar" as const,
      ...showNotice({
        message: "正在同步日历记录...",
        type: "info",
        position: "top-right",
        durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;

    try {
      if (loadedCloudMonthKeysRef.current.has(monthKey)) {
        notice.update({
          message: "日历记录已就绪",
          type: "success",
          durationMs: 1200,
        });
        return;
      }
      calendarSyncMachine.setPhase(token, "fetching");
      loadedCloudMonthKeysRef.current.add(monthKey);
      const keys = await listConversationDateKeysFromCloud({
        contactId,
        fromDateKey,
        toDateKey: monthEndDateKey,
        signal: controller.signal,
      });
      if (!isMountedRef.current) return;
      calendarSyncMachine.setPhase(token, "merging");
      setCloudDateKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.add(key));
        return next;
      });
      if (isDateSheetOpen && syncNoticeRef.current === notice) {
        notice.update({
          message: "日历记录已更新",
          type: "success",
          durationMs: 1200,
        });
      } else {
        notice.hide();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        notice.hide();
        return;
      }
      console.warn("preloadCloudMonthDateKeys failed", {
        monthKey,
        fromDateKey,
        toDateKey: monthEndDateKey,
        message: error instanceof Error ? error.message : String(error),
      });
      loadedCloudMonthKeysRef.current.delete(monthKey);
      if (isDateSheetOpen && syncNoticeRef.current === notice) {
        notice.update({
          message: "日历记录同步失败",
          type: "warning",
          durationMs: 1800,
        });
      } else {
        notice.hide();
      }
    } finally {
      if (syncNoticeRef.current === notice) {
        syncNoticeRef.current = null;
      }
      calendarSyncMachine.setPhase(token, "settling");
      calendarSyncMachine.settle(token);
    }
  }

  async function resolveConversationIdForDate(dateKey: string, signal?: AbortSignal): Promise<string | null> {
    const resolved = await findConversationIdByDateFromCloud({
      dateKey,
      contactId,
      signal,
    });
    const todayKey = toDateKey(new Date());
    const fallback = dateKey === todayKey ? conversationId : null;
    const finalId = resolved ?? fallback ?? null;
    if (isMountedRef.current && finalId && finalId !== conversationId) {
      setConversationId(finalId);
    }
    return finalId;
  }

  function mapCloudRows(
    rows: Awaited<ReturnType<typeof listDayMessagesFromCloud>>
  ): ChatMessage[] {
    return rows.map((row) => ({
      id: row.id,
      localId: row.id,
      role: row.role,
      text: row.content,
      time: new Date(row.createdAt).toTimeString().slice(0, 5),
      createdAt: row.createdAt,
      conversationDateKey: row.conversationDateKey ?? null,
      status: row.status,
      clozeState: row.clozeState ?? null,
      clozeVersion: row.clozeVersion ?? 0,
      clozePracticeDiscardedAt: row.clozePracticeDiscardedAt ?? null,
    }));
  }

  async function runHistoryLoading<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return runWithDeferredBlockingLoading(
      task,
      { show: setLoadingOptions, hide: () => setLoadingOptions(null) },
      {
        blocking: true,
        abortable: true,
        cancelableAfterMs: 10000,
        timeoutMs: 20000,
        onTimeout: () => setDialog({ message: "同步超时，请稍后重试。" }),
      },
    );
  }

  const {
    clozeEditor,
    clozeDelete,
    setClozeEditor,
    setClozeDelete,
    handleTextSelection,
    handleEditClozeGroup,
    handleDeleteClozeGroup,
    confirmDeleteCloze,
    toggleDraftToken,
    confirmClozeEditor,
  } = useChatClozeEditing({
    contact,
    contactId,
    dayMessages,
    isSelectedDateSyncing,
    isProEntitledRef,
    syncNoticeRef,
    syncMachine: clozeSaveMachine,
    setDayMessages,
    setMessages,
    setLocalDateKeys,
    setIsProEntitled,
    setDialog,
    showNotice,
    runHistoryLoading,
  });

  async function syncDayFromCloud(
    d: Date,
    options?: { force?: boolean; signal?: AbortSignal; syncToken?: number }
  ): Promise<{ synced: boolean; changed: boolean }> {
    const localPro = await hasLocalProAccess();
    const [session, entitlement] = await Promise.all([
      getSession(),
      localPro ? getCurrentEntitlement().catch(() => null) : Promise.resolve(null),
    ]);
    const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";
    const isPro = entitlement?.isPro === true;
    if (!isMountedRef.current) return { synced: false, changed: false };
    setIsProEntitled(isPro);
    const dateKey = toDateKey(d);
    const reqId = ++syncSeqRef.current;
    latestSyncReqByDateRef.current[dateKey] = reqId;
    // 同一天 5 分钟内只允许命中一次拉取，避免进出页面时反复打云端。
    const lastSyncedAt = lastCloudSyncAtByDateRef.current[dateKey] ?? 0;
    if (!options?.force && Date.now() - lastSyncedAt <= 5 * 60 * 1000) {
      return { synced: true, changed: false };
    }

    if (!isPro) return { synced: false, changed: false };

    // 这里只推进 day 业务状态，不负责弹什么提示；提示逻辑在 syncDateQuietly 里统一做。
    if (options?.syncToken) {
      daySyncMachine.setPhase(options.syncToken, "checking");
    }
    const resolvedConversationId = await resolveConversationIdForDate(dateKey, options?.signal);
    if (!isMountedRef.current) return { synced: false, changed: false };
    if (!resolvedConversationId) return { synced: false, changed: false };

    if (options?.syncToken) {
      daySyncMachine.setPhase(options.syncToken, "fetching");
    }
    const allRows = await listDayMessagesFromCloud({
      conversationId: resolvedConversationId,
      userId,
      dateKey,
      signal: options?.signal,
    });
    if (!isMountedRef.current) return { synced: false, changed: false };
    if (latestSyncReqByDateRef.current[dateKey] !== reqId) return { synced: false, changed: false };

    if (options?.syncToken) {
      daySyncMachine.setPhase(options.syncToken, "merging");
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
    const cachedLoaded = (dayLoadedRowsRef.current[dayKey] ?? []).slice().sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    let nextVisibleDay = visibleMapped;
    if (!options?.force && nextVisibleDay.length < cachedLoaded.length) {
      nextVisibleDay = cachedLoaded;
    }
    const previousVisibleDay = toDisplayRows(await loadChatMessagesByDate(contactId, dayKey)).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    const changed = !areMessageRowsEquivalent(previousVisibleDay, nextVisibleDay);
    dayLoadedRowsRef.current[dayKey] = nextVisibleDay;

    await replaceChatMessagesByDate(contactId, dayKey, nextVisibleDay);
    setLocalDateKeys((prev) => new Set([...prev, dayKey]));
    lastCloudSyncAtByDateRef.current[dayKey] = Date.now();
    if (selectedDateKeyRef.current === dayKey) {
      setDayMessages(nextVisibleDay);
      setMessages(nextVisibleDay);
    }
    return { synced: true, changed };
  }

  async function syncDateQuietly(d: Date, options?: { force?: boolean }): Promise<void> {
    const dateKey = toDateKey(d);
    const lastSyncedAt = lastCloudSyncAtByDateRef.current[dateKey] ?? 0;
    if (!options?.force && Date.now() - lastSyncedAt <= 5 * 60 * 1000) {
      return;
    }

    const { token, controller } = daySyncMachine.begin("chat_day", dateKey);
    const isTodaySync = isSameDate(d, new Date());
    if (isTodaySync) {
      setIsTodaySyncing(true);
    }
    setSyncingDateKey(dateKey);

    // notice 是一条单独的 UI 通道，不看业务分类，谁后发谁顶掉前面的。
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "messages" as const,
      ...showNotice({
      message: "正在同步最新消息...",
      type: "info",
      position: "top-right",
      durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;
    try {
      daySyncMachine.setPhase(token, "fetching");
      const result = await syncDayFromCloud(d, { ...options, signal: controller.signal, syncToken: token });
      if (!isMountedRef.current) {
        notice.hide();
        return;
      }
      if (!result.synced || !result.changed) {
        notice.hide();
        return;
      }
      daySyncMachine.setPhase(token, "settling");
      // 业务已经更新完了，再把 notice 收成成功态；这里和业务阶段是两条线。
      notice.update({
        message: "消息已更新",
        type: "success",
        durationMs: 1800,
      });
    } catch {
      if (controller.signal.aborted) {
        notice.hide();
        return;
      }
      if (!isMountedRef.current) {
        notice.hide();
        return;
      }
      notice.update({
        message: "同步失败，稍后再试",
        type: "warning",
        durationMs: 2200,
      });
    } finally {
      if (syncNoticeRef.current === notice) {
        syncNoticeRef.current = null;
      }
      if (isTodaySync) {
        if (isMountedRef.current) setIsTodaySyncing(false);
      }
      if (isMountedRef.current) {
        setSyncingDateKey((current) => (current === dateKey ? null : current));
      }
      daySyncMachine.settle(token);
    }
  }

  async function handleSelectDate(d: Date): Promise<void> {
    Keyboard.dismiss();
    setSelectedDate(d);
    setIsDateSheetOpen(false);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));

    const visibleLocalRows = toDisplayRows(await loadChatMessagesByDate(contactId, toDateKey(d)));
    if (visibleLocalRows.length > 0) {
      setDayMessages(visibleLocalRows);
      setMessages(visibleLocalRows);
    }

    void syncDateQuietly(d);
  }

  const recordDateKeys = useMemo(() => {
    const set = new Set<string>();
    for (const k of localDateKeys) set.add(k);
    for (const k of cloudDateKeys) set.add(k);
    return set;
  }, [localDateKeys, cloudDateKeys]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.content, { paddingBottom: keyboardInset }]}>
        <ChatHeader
          contact={contact}
          onBack={onBack}
          onOpenCalendar={() => setIsDateSheetOpen(true)}
          onOpenMenu={openAutoCopyMenu}
        />

        <MessageList
          contact={contact}
          messages={messages}
          selectedDateLabel={selectedDateLabelText(selectedDate)}
          listRef={messageListRef}
          onScrollBeginDrag={handleScrollBeginDrag}
          onRetryMessage={handleRetryMessage}
          onCopyMessage={handleCopyMessage}
          onTextSelection={handleTextSelection}
          onEditClozeGroup={handleEditClozeGroup}
          onDeleteClozeGroup={handleDeleteClozeGroup}
        />

        <ChatComposer
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
          onStop={handleStopGenerating}
          onFocus={handleComposerFocus}
          onDisabledPress={() => {
            if (isAnotherContactGenerating) {
              Alert.alert("另一个好友正在回复，请稍后再发")
              return;
            }
            if (isTodaySyncing) {
              Alert.alert("正在同步消息，请稍后发送")
              return;
            }
            if (remainingChars !== null && remainingChars <= 0) {
              Alert.alert("字符额度已用尽");
              return;
            }
            const inputLength = inputText.trim().length;
            const { min: minInputChars, max: maxInputChars } = getChatGenerationInputLimits();
            if (inputLength > 0 && inputLength < minInputChars) {
              Alert.alert(`至少输入 ${minInputChars} 个字符`)
              return;
            }
            if (inputLength > maxInputChars) {
              Alert.alert(`最多输入 ${maxInputChars} 个字符`)
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
      <ClozeControls
        contact={contact}
        editor={clozeEditor}
        deleteTarget={clozeDelete}
        onCloseEditor={() => setClozeEditor(null)}
        onToggleDraftToken={toggleDraftToken}
        onConfirmEditor={() => void confirmClozeEditor()}
        onCloseDelete={() => setClozeDelete(null)}
        onConfirmDelete={() => void confirmDeleteCloze()}
      />
      <BlockingLoading visible={!!loadingOptions} options={loadingOptions} />
      <InfoDialog config={dialog} onClose={() => setDialog(null)} />
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
