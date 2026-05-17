import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  ToastAndroid,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession } from "../services/auth/authStorage";
import { getCurrentEntitlement } from "../services/api/meApi";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
import {
  findConversationIdByDateFromCloud,
  listConversationDateKeysFromCloud,
  listDayMessagesFromCloud,
  updateMessageClozeState,
} from "../services/api/chatHistoryApi";
import { createLocalRewritePair } from "../services/chat/chatSyncService";
import {
  appendRewriteMessages,
  ensureRewriteMessagesLoaded,
  replaceRewriteMessages,
  startRewriteSession,
  stopRewriteSession,
  subscribeRewriteSession,
} from "../services/chat/rewriteSessionService";
import {
  type AutoCopyMode,
  loadAssistantPreferences,
  saveAssistantPreferences,
} from "../services/preferences/assistantPreferences";
import { copyTextToClipboard } from "../services/device/clipboardService";
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
import {
  ClozeControls,
  type ClozeDeleteState,
  type ClozeEditorState,
  type ClozeFabState,
} from "./chat/ClozeControls";
import type { ChatMessage } from "../domain/chat/types";
import type { NativeTextSelectionPayload } from "./chat/SelectableMessageText";
import {
  expandSelectionToTokenRange,
  normalizeClozeState,
  removeClozeGroup,
  replaceClozeGroup,
} from "../domain/cloze/clozeUtils";
import { getRewriteChinese, getRewriteEnglish } from "../domain/rewrite/taggedRewrite";
import {
  filterByDate,
  isSameDate,
  toDateKey,
} from "../domain/chat/messageState";

function getMonthRange(cursor: Date): { monthKey: string; fromDateKey: string; toDateKey: string } {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);

  return {
    monthKey: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    fromDateKey: toDateKey(firstDay),
    toDateKey: toDateKey(lastDay),
  };
}

type ChatScreenProps = {
  onBack: () => void;
};

export function ChatScreen({ onBack }: ChatScreenProps) {
  const window = useWindowDimensions();
  const { showNotice } = useFloatingNotice();
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
  const [autoCopyMode, setAutoCopyMode] = useState<AutoCopyMode>("en");
  const [remainingChars, setRemainingChars] = useState<number | null>(null);
  const [isProEntitled, setIsProEntitled] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [clozeFab, setClozeFab] = useState<ClozeFabState | null>(null);
  const [clozeEditor, setClozeEditor] = useState<ClozeEditorState | null>(null);
  const [clozeDelete, setClozeDelete] = useState<ClozeDeleteState | null>(null);
  const [loadingOptions, setLoadingOptions] = useState<BlockingLoadingOptions | null>(null);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const [isTodaySyncing, setIsTodaySyncing] = useState(false);
  const allLocalMessagesRef = useRef<ChatMessage[]>([]);
  const messageListRef = useRef<FlatList<any> | null>(null);
  const selectedDateKeyRef = useRef(toDateKey(new Date()));
  const dayLoadedRowsRef = useRef<Record<string, ChatMessage[]>>({});
  const syncSeqRef = useRef(0);
  const latestSyncReqByDateRef = useRef<Record<string, number>>({});
  const lastCloudSyncAtByDateRef = useRef<Record<string, number>>({});
  const loadedCloudMonthKeysRef = useRef<Set<string>>(new Set());
  const clozeSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isProEntitledRef = useRef(false);
  const todaySyncCountRef = useRef(0);
  const isTodaySyncingRef = useRef(false);
  const syncNoticeHandlesRef = useRef<Array<{ hide: () => void }>>([]);
  const syncAbortControllersRef = useRef<AbortController[]>([]);
  const clozeSaveQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const scrollToBottom = React.useCallback((animated = false): void => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated });
    });
  }, []);
  const canSend = useMemo(() => {
    const hasQuota = remainingChars === null ? true : remainingChars > 0;
    return inputText.trim().length > 0 && !isSending && !isTodaySyncing && hasQuota;
  }, [inputText, isSending, isTodaySyncing, remainingChars]);

  // 生命周期清理：退出聊天页时取消仍在进行的历史同步，并清掉全局轻提示。
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      todaySyncCountRef.current = 0;
      // 用户快速进出聊天页时，历史同步请求可能还在进行；退出时主动取消，
      // 避免旧同步继续占用网络/服务端资源，或在页面卸载后更新全局提示气泡。
      syncAbortControllersRef.current.forEach((controller) => controller.abort());
      syncAbortControllersRef.current = [];
      syncNoticeHandlesRef.current.forEach((notice) => notice.hide());
      syncNoticeHandlesRef.current = [];
    };
  }, []);

  // Ref 镜像：给异步回调读取最新的本地消息，避免闭包拿到旧 state。
  useEffect(() => {
    allLocalMessagesRef.current = allLocalMessages;
  }, [allLocalMessages]);

  // Ref 镜像：同步回包时用它判断用户当前还停在哪一天。
  useEffect(() => {
    selectedDateKeyRef.current = toDateKey(selectedDate);
  }, [selectedDate]);

  // Ref 镜像：填空保存等异步逻辑需要读取最新 Pro 状态。
  useEffect(() => {
    isProEntitledRef.current = isProEntitled;
  }, [isProEntitled]);

  // Ref 镜像：发送入口用它即时判断今天同步锁，避免按钮状态刷新前抢发。
  useEffect(() => {
    isTodaySyncingRef.current = isTodaySyncing;
  }, [isTodaySyncing]);

  // 启动初始化：加载自动复制偏好。
  useEffect(() => {
    let cancelled = false;
    async function bootstrapPreferences() {
      const preferences = await loadAssistantPreferences();
      if (!cancelled) {
        setAutoCopyAfterRewrite(preferences.autoCopyAfterRewrite);
        setAutoCopyMode(preferences.autoCopyMode);
      }
    }
    void bootstrapPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const rows = await ensureRewriteMessagesLoaded();
      if (cancelled) return;
      setAllLocalMessages(rows);
      allLocalMessagesRef.current = rows;
      // 会话级单调缓存：某天已经展示过的行数，作为本次 app 运行期间的保底显示。
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

  // 生成会话订阅：接收流式改写状态和消息列表更新。
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

  // 键盘监听：键盘弹出/收起时调整底部间距并滚动到底部。
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

  // 键盘补偿滚动：键盘高度或消息数变化后，再补一次滚动，避免末尾被遮挡。
  useEffect(() => {
    if (keyboardInset <= 0) return;
    const timer = setTimeout(() => {
      scrollToBottom(false);
    }, 48);
    return () => clearTimeout(timer);
  }, [keyboardInset, messages.length, scrollToBottom]);

  // 启动同步：进入聊天页后静默同步今天，兼顾多端新增消息。
  useEffect(() => {
    const today = new Date();
    void syncDateQuietly(today);
  }, []);

  // 日期面板：打开日历时预加载当前月份云端有记录的日期。
  useEffect(() => {
    if (!isDateSheetOpen) return;
    void preloadCloudMonthDateKeys(monthCursor);
  }, [isDateSheetOpen, monthCursor]);

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

  async function copyAssistantTaggedText(text: string, mode: AutoCopyMode, silent = false): Promise<void> {
    const en = getRewriteEnglish(text).trim();
    const zh = getRewriteChinese(text).trim();
    const copyText =
      mode === "en"
        ? en
        : mode === "zh"
          ? zh
          : [en, zh].filter(Boolean).join("\n");
    await copyAssistantText(copyText || text, silent);
  }

  const handleCopyMessage = React.useCallback(
    (message: ChatMessage) => {
      void copyAssistantTaggedText(message.text, autoCopyMode);
    },
    [autoCopyMode]
  );

  const handleScrollBeginDrag = React.useCallback(() => {
    Keyboard.dismiss();
    setClozeFab(null);
  }, []);

  const handleTextSelection = React.useCallback(
    (message: ChatMessage, payload: NativeTextSelectionPayload, clearSelection: () => void) => {
      if (clozeSelectionTimerRef.current) {
        clearTimeout(clozeSelectionTimerRef.current);
      }
      if (payload.start === payload.end) {
        setClozeFab(null);
        return;
      }
      const expanded = expandSelectionToTokenRange(
        getRewriteEnglish(message.text),
        payload.start,
        payload.end,
        message.clozeState,
        payload.isBackward === true,
      );
      if (!expanded) {
        setClozeFab(null);
        return;
      }
      if (payload.endX === 0 && payload.endY === 0) {
        clearSelection();
        setClozeFab(null);
        setClozeEditor({
          message,
          groupIndex: null,
          tokenIndexes: expanded.tokenIndexes,
          draftBlankIndexes: [],
        });
        return;
      }
      clozeSelectionTimerRef.current = setTimeout(() => {
        setClozeFab({
          message,
          tokenIndexes: expanded.tokenIndexes,
          x: payload.endX,
          y: payload.endY,
          clearSelection,
        });
      }, 180);
    },
    [],
  );

  function openNewClozeEditor(): void {
    if (!clozeFab) return;
    clozeFab.clearSelection();
    setClozeEditor({
      message: clozeFab.message,
      groupIndex: null,
      tokenIndexes: clozeFab.tokenIndexes,
      draftBlankIndexes: [], // 默认没有空
    });
    setClozeFab(null);
  }

  const handleEditClozeGroup = React.useCallback((message: ChatMessage, groupIndex: number) => {
    const group = normalizeClozeState(message.clozeState)?.groups[groupIndex];
    if (!group) return;
    setClozeEditor({
      message,
      groupIndex,
      tokenIndexes: group.tokenIndexes,
      draftBlankIndexes: group.blankTokenIndexes,
    });
  }, []);

  const handleDeleteClozeGroup = React.useCallback((message: ChatMessage, groupIndex: number) => {
    setClozeDelete({ message, groupIndex });
  }, []);

  async function confirmDeleteCloze(): Promise<void> {
    if (!clozeDelete) return;
    const target = clozeDelete;
    setClozeDelete(null);
    await runHistoryLoading(() =>
      saveMessageCloze(target.message, removeClozeGroup(target.message.clozeState, target.groupIndex))
    );
  }

  function toggleDraftToken(tokenIndex: number): void {
    setClozeEditor((current) => {
      if (!current) return current;
      const set = new Set(current.draftBlankIndexes);
      if (set.has(tokenIndex)) set.delete(tokenIndex);
      else set.add(tokenIndex);
      return { ...current, draftBlankIndexes: Array.from(set).sort((a, b) => a - b) };
    });
  }

  async function confirmClozeEditor(): Promise<void> {
    if (!clozeEditor) return;
    const nextState = replaceClozeGroup(
      clozeEditor.message.clozeState,
      clozeEditor.groupIndex,
      clozeEditor.tokenIndexes,
      clozeEditor.draftBlankIndexes,
    );
    const target = clozeEditor.message;
    setClozeEditor(null);
    await runHistoryLoading(() => saveMessageCloze(target, nextState));
  }

  async function saveMessageCloze(message: ChatMessage, clozeState: ChatMessage["clozeState"]): Promise<void> {
    const key = message.id ?? message.localId;
    const previous = clozeSaveQueueRef.current.get(key) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => persistMessageCloze(message, clozeState));
    clozeSaveQueueRef.current.set(key, queued);
    try {
      await queued;
    } finally {
      if (clozeSaveQueueRef.current.get(key) === queued) {
        clozeSaveQueueRef.current.delete(key);
      }
    }
  }

  async function persistMessageCloze(message: ChatMessage, clozeState: ChatMessage["clozeState"]): Promise<void> {
    const matches = (row: ChatMessage) => isSameChatMessage(row, message);
    const currentMessage = allLocalMessagesRef.current.find(matches) ?? message;
    const baseVersion = currentMessage.clozeVersion ?? 0;
    const optimistic = { ...currentMessage, clozeState, clozeVersion: baseVersion + 1 };
    await applyMessageUpdate(optimistic);

    if (currentMessage.id) {
      const isPro = await hasLocalProAccess();
      isProEntitledRef.current = isPro;
      setIsProEntitled(isPro);
    }

    if (!isProEntitledRef.current || !currentMessage.id) {
      return;
    }

    try {
      const saved = await updateMessageClozeState({
        messageId: currentMessage.id,
        baseVersion,
        clozeState,
      });
      await applyMessageUpdate({
        ...optimistic,
        clozeState: saved.clozeState ?? null,
        clozeVersion: saved.clozeVersion,
      });
    } catch (error) {
      const latest = (error as { latest?: { clozeState: ChatMessage["clozeState"]; clozeVersion: number } }).latest;
      if (latest) {
        await applyMessageUpdate({
          ...currentMessage,
          clozeState: latest.clozeState ?? null,
          clozeVersion: latest.clozeVersion,
        });
        return;
      }
      await applyMessageUpdate(currentMessage);
      setDialog({ message: "保存填空失败，请稍后重试。" });
    }
  }

  async function applyMessageUpdate(nextMessage: ChatMessage): Promise<void> {
    const replace = (rows: ChatMessage[]) =>
      rows.map((row) => (isSameChatMessage(row, nextMessage) ? nextMessage : row));
    const nextAll = replace(allLocalMessagesRef.current);
    const nextDay = replace(dayMessages);
    allLocalMessagesRef.current = nextAll;
    setAllLocalMessages(nextAll);
    setDayMessages(nextDay);
    setMessages(nextDay);
    await replaceRewriteMessages(nextAll);
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

  async function handleSetAutoCopyMode(mode: AutoCopyMode): Promise<void> {
    setAutoCopyAfterRewrite(true);
    setAutoCopyMode(mode);
    await saveAssistantPreferences({ autoCopyAfterRewrite: true, autoCopyMode: mode });
  }

  function handleOpenMenu(): void {
    Alert.alert("自动复制", autoCopyModeLabel(autoCopyMode), [
      {
        text: "只自动复制英文",
        onPress: () => {
          void handleSetAutoCopyMode("en");
        },
      },
      {
        text: "只自动复制中文",
        onPress: () => {
          void handleSetAutoCopyMode("zh");
        },
      },
      {
        text: "两个都自动复制",
        onPress: () => {
          void handleSetAutoCopyMode("both");
        },
      },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function handleSend(): Promise<void> {
    const text = inputText.trim();
    if (!text || isSending) return;
    if (isTodaySyncingRef.current) {
      showNotice({
        message: "正在同步消息，请稍后发送",
        type: "info",
        position: "top-right",
        durationMs: 1500,
      });
      return;
    }
    if (remainingChars !== null && remainingChars <= 0) {
      Alert.alert("You've reached your daily quota.");
      return;
    }

    const now = new Date();
    const isViewingToday = isSameDate(selectedDate, now);

    if (!isViewingToday) {
      setSelectedDate(now);
      setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
      const byDay = toDisplayRows(filterByDate(allLocalMessagesRef.current, now));
      setDayMessages(byDay);
      setMessages(byDay);
      void syncDateQuietly(now, { force: true });
      return;
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

  async function preloadCloudMonthDateKeys(cursor: Date): Promise<void> {
    if (!(await hasLocalProAccess())) return;

    const { monthKey, fromDateKey, toDateKey: monthEndDateKey } = getMonthRange(cursor);
    if (loadedCloudMonthKeysRef.current.has(monthKey)) return;
    loadedCloudMonthKeysRef.current.add(monthKey);
    const controller = new AbortController();
    syncAbortControllersRef.current.push(controller);

    try {
      const keys = await listConversationDateKeysFromCloud({
        contactId: "rewrite_assistant",
        fromDateKey,
        toDateKey: monthEndDateKey,
        signal: controller.signal,
      });
      if (!isMountedRef.current) return;
      setCloudDateKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.add(key));
        return next;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("preloadCloudMonthDateKeys failed", {
        monthKey,
        fromDateKey,
        toDateKey: monthEndDateKey,
        message: error instanceof Error ? error.message : String(error),
      });
      loadedCloudMonthKeysRef.current.delete(monthKey);
    } finally {
      syncAbortControllersRef.current = syncAbortControllersRef.current.filter((item) => item !== controller);
    }
  }

  async function resolveConversationIdForDate(dateKey: string, signal?: AbortSignal): Promise<string | null> {
    const resolved = await findConversationIdByDateFromCloud({
      dateKey,
      contactId: "rewrite_assistant",
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

  async function syncDayFromCloud(
    d: Date,
    options?: { force?: boolean; signal?: AbortSignal }
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

    if (!isPro) return { synced: false, changed: false };

    const resolvedConversationId = await resolveConversationIdForDate(dateKey, options?.signal);
    if (!isMountedRef.current) return { synced: false, changed: false };
    if (!resolvedConversationId) return { synced: false, changed: false };

    const allRows = await listDayMessagesFromCloud({
      conversationId: resolvedConversationId,
      userId,
      dateKey,
      signal: options?.signal,
    });
    if (!isMountedRef.current) return { synced: false, changed: false };
    if (latestSyncReqByDateRef.current[dateKey] !== reqId) return { synced: false, changed: false };

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
    const previousVisibleDay = toDisplayRows(filterByDate(allLocalMessagesRef.current, d)).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    const changed = !areMessageRowsEquivalent(previousVisibleDay, nextVisibleDay);
    dayLoadedRowsRef.current[dayKey] = nextVisibleDay;

    const replaced = [...baseRows, ...nextVisibleDay].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    setAllLocalMessages(replaced);
    allLocalMessagesRef.current = replaced;
    await replaceRewriteMessages(replaced);
    lastCloudSyncAtByDateRef.current[dayKey] = Date.now();
    if (selectedDateKeyRef.current === dayKey) {
      setDayMessages(nextVisibleDay);
      setMessages(nextVisibleDay);
    }
    return { synced: true, changed };
  }

  async function syncDateQuietly(d: Date, options?: { force?: boolean }): Promise<void> {
    const controller = new AbortController();
    syncAbortControllersRef.current.push(controller);
    const isTodaySync = isSameDate(d, new Date());
    if (isTodaySync) {
      todaySyncCountRef.current += 1;
      setIsTodaySyncing(true);
    }
    const notice = showNotice({
      message: "正在同步最新消息...",
      type: "info",
      position: "top-right",
      durationMs: 0,
    });
    syncNoticeHandlesRef.current.push(notice);
    try {
      const result = await syncDayFromCloud(d, { ...options, signal: controller.signal });
      if (!isMountedRef.current) {
        notice.hide();
        return;
      }
      if (!result.synced || !result.changed) {
        notice.hide();
        return;
      }
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
      syncAbortControllersRef.current = syncAbortControllersRef.current.filter((item) => item !== controller);
      syncNoticeHandlesRef.current = syncNoticeHandlesRef.current.filter((item) => item !== notice);
      if (isTodaySync) {
        todaySyncCountRef.current = Math.max(0, todaySyncCountRef.current - 1);
        if (isMountedRef.current && todaySyncCountRef.current === 0) {
          setIsTodaySyncing(false);
        }
      }
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

    void syncDateQuietly(d, { force: true });
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
            if (isTodaySyncing) {
              showNotice({
                message: "正在同步消息，请稍后发送",
                type: "info",
                position: "top-right",
                durationMs: 1500,
              });
              return;
            }
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
      <ClozeControls
        fab={clozeFab}
        editor={clozeEditor}
        deleteTarget={clozeDelete}
        screenWidth={window.width}
        screenHeight={window.height}
        onCloseFab={() => setClozeFab(null)}
        onOpenNewEditor={openNewClozeEditor}
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

function toDisplayRows(rows: ChatMessage[]): ChatMessage[] {
  return rows.filter((row) => row.status === "success" || row.status === "pending");
}

function isSameChatMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (a.id !== undefined && b.id !== undefined && a.id === b.id) || a.localId === b.localId;
}

function areMessageRowsEquivalent(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.localId !== right.localId ||
      left.role !== right.role ||
      left.text !== right.text ||
      left.status !== right.status ||
      left.createdAt !== right.createdAt ||
      (left.clozeVersion ?? 0) !== (right.clozeVersion ?? 0) ||
      JSON.stringify(left.clozeState ?? null) !== JSON.stringify(right.clozeState ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function autoCopyModeLabel(mode: AutoCopyMode): string {
  if (mode === "zh") return "当前：只自动复制中文";
  if (mode === "both") return "当前：英文和中文都自动复制";
  return "当前：只自动复制英文";
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
