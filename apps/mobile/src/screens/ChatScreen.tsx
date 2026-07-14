import { useNetInfo } from "@react-native-community/netinfo";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSession } from "../services/auth/authStorage";
import { getCurrentEntitlement, getUserPreference } from "../services/api/meApi";
import { hasLocalProAccess } from "../services/entitlement/proAccess";
import {
  findConversationIdByDateFromCloud,
  importLocalDayMessagesToCloud,
  listConversationDateKeysFromCloud,
  listDayMessagesFromCloud,
} from "../services/api/chatHistoryApi";
import { createLocalChatPair } from "../services/chat/chatGenerationService";
import {
  appendChatMessages,
  getActiveAssistantClientIds,
  getChatGenerationActivitySnapshot,
  listStoredChatDateKeys,
  loadChatMessagesByDate,
  replaceChatMessagesByDate,
  startChatSession,
  subscribeChatGenerationActivity,
  subscribeChatSession,
} from "../services/chat/chatSessionService";
import { copyAssistantTaggedText } from "../services/chat/assistantCopyService";
import {
  clearChatInputDraft,
  loadChatInputDraft,
  saveChatInputDraft,
} from "../services/chat/chatDraftStorage";
import { getMonthRange, selectedDateLabelText } from "../services/chat/chatDateRange";
import { countChatGenerationInputChars, getChatGenerationInputLimits } from "../services/chat/chatInputLimits";
import { areMessageRowsEquivalent, toDisplayRows } from "../services/chat/chatMessageView";
import { useAssistantAutoCopyPreferences } from "../hooks/useAssistantAutoCopyPreferences";
import { useExclusiveSyncMachine } from "../hooks/useExclusiveSyncMachine";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatComposer, type ChatComposerSttPressContext } from "./chat/ChatComposer";
import { MessageList } from "./chat/MessageList";
import { AutoCopySheet } from "./chat/AutoCopySheet";
import type { NativeTextSelectionPayload, SelectableMessageTextRef } from "./chat/SelectableMessageText";
import { DictionaryPopover } from "./chat/DictionaryPopover";
import { DatePickerSheet } from "./chat/DatePickerSheet";
import { useFloatingNotice } from "./shared/FloatingNotice";
import { InfoDialog, type InfoDialogConfig } from "./shared/InfoDialog";
import { ClozeControls } from "./chat/ClozeControls";
import { TtsMiniPlayer } from "../components/TtsMiniPlayer";
import type { ChatMessage } from "../domain/chat/types";
import { useChatClozeEditing } from "../hooks/useChatClozeEditing";
import { consumeChatDateDirty } from "../services/chat/chatPracticeSyncState";
import {
  compareChatMessagesByCreatedAt,
  INACTIVE_ASSISTANT_PLACEHOLDER_GRACE_MS,
  removeInactiveAssistantPlaceholders,
  toDateKey,
} from "../domain/chat/messageState";
import type { ChatContact } from "../domain/chat/contacts";
import type { AutoCopyMode } from "../services/preferences/assistantPreferences";
import { dateKeyToDate, getBusinessDateKey } from "../services/time/serverClock";
import { getLanguage, t, tf } from "../i18n";
import { stopTtsAudio } from "../services/tts/ttsPlayback";
import { lookupDictionary, type DictionaryLookupResult } from "../services/api/dictionaryApi";
import { openRealtimeSttSession, type RealtimeSttSession } from "../services/api/sttRealtimeApi";
import { createPicovoiceRealtimeAudioSource } from "../services/stt/picovoiceRealtimeAudioSource";
import type { PcmAudioFrame, RealtimeAudioSource } from "../services/stt/realtimeAudioSource";

const STT_PREBUFFER_MAX_FRAMES = 180;

type ChatScreenProps = {
  contact: ChatContact;
  onBack: () => void;
};

type DictionaryLookupState = {
  term: string;
  messageId?: string | null;
  textStart: number;
  textEnd: number;
  anchor?: NativeTextSelectionPayload["selectionRect"];
  loading: boolean;
  error: string | null;
  result: DictionaryLookupResult | null;
};

type SttRecognitionPlan = {
  languageIdMode: "at_start" | "continuous";
  candidateLanguages: string[];
};

const MULTILINGUAL_STT_LANGUAGES = ["zh-CN", "ja-JP", "ko-KR", "en-US"];

export function ChatScreen({ contact, onBack }: ChatScreenProps) {
  const { showNotice } = useFloatingNotice();
  const contactId = contact.id;
  const [inputText, setInputText] = useState("");
  const [sttStatus, setSttStatus] = useState<"idle" | "connecting" | "recording" | "stopping">("idle");
  const [composerSelectionOverride, setComposerSelectionOverride] = useState<{ start: number; end: number } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [activeGenerationContactId, setActiveGenerationContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [inputProtectionActive, setInputProtectionActive] = useState(false);
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dayMessages, setDayMessages] = useState<ChatMessage[]>([]);
  const [localDateKeys, setLocalDateKeys] = useState<Set<string>>(new Set());
  const [cloudDateKeys, setCloudDateKeys] = useState<Set<string>>(new Set());
  const {
    companionModeByContactId,
    isAutoCopyMenuOpen,
    openAutoCopyMenu,
    closeAutoCopyMenu,
    setCompanionMode,
  } = useAssistantAutoCopyPreferences();
  const companionMode = companionModeByContactId[contactId] ?? contact.defaultCompanionMode ?? "rewrite_only";
  const canConfigureCompanionMode = contact.capabilities?.companionMode === true;
  const [remainingChars, setRemainingChars] = useState<number | null>(null);
  const [isProEntitled, setIsProEntitled] = useState(false);
  const [dialog, setDialog] = useState<InfoDialogConfig | null>(null);
  const [isTodaySyncing, setIsTodaySyncing] = useState(false);
  const [syncingDateKey, setSyncingDateKey] = useState<string | null>(null);
  const [businessTodayKey, setBusinessTodayKey] = useState<string | null>(null);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);
  const [dictionaryLookup, setDictionaryLookup] = useState<DictionaryLookupState | null>(null);
  const messageListRef = useRef<FlatList<any> | null>(null);
  const contactIdRef = useRef(contactId);
  const inputTextRef = useRef("");
  const scrollMetricsRef = useRef({ y: 0, contentHeight: 0, layoutHeight: 0 });
  const pendingScrollToBottomRef = useRef<{ animated: boolean } | null>(null);
  const activeSelectionRef = useRef<SelectableMessageTextRef | null>(null);
  const activeCopyMenuRef = useRef(false);
  const closeCopyMenuRef = useRef<(() => void) | null>(null);
  const messageTextTouchActiveRef = useRef(false);
  const commandTouchActiveRef = useRef(false);
  const selectedDateKeyRef = useRef(toDateKey(new Date()));
  const dayLoadedRowsRef = useRef<Record<string, ChatMessage[]>>({});
  const syncSeqRef = useRef(0);
  const latestSyncReqByDateRef = useRef<Record<string, number>>({});
  const lastCloudSyncAtByDateRef = useRef<Record<string, number>>({});
  const loadedCloudMonthKeysRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const dictionaryAbortRef = useRef<AbortController | null>(null);
  const sttAudioSourceRef = useRef<RealtimeAudioSource | null>(null);
  const sttSessionRef = useRef<RealtimeSttSession | null>(null);
  const sttGenerationRef = useRef(0);
  const sttDraftBaseRef = useRef("");
  const sttInsertRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const sttFinalTextRef = useRef("");
  const sttPartialTextRef = useRef("");
  const sttStatusRef = useRef<"idle" | "connecting" | "recording" | "stopping">("idle");
  const sttMultilingualRecognitionEnabledRef = useRef(false);
  const dictionaryRequestSeqRef = useRef(0);
  const isProEntitledRef = useRef(false);
  const isTodaySyncingRef = useRef(false);
  const draftLoadedContactRef = useRef<string | null>(null);
  const syncNoticeRef = useRef<{ hide: () => void; update: (next: any) => void; kind: "calendar" | "messages" | "cloze" } | null>(null);
  const daySyncMachine = useExclusiveSyncMachine<"chat_day">();
  const calendarSyncMachine = useExclusiveSyncMachine<"chat_calendar">();
  const clozeSaveMachine = useExclusiveSyncMachine<"cloze_save">();
  const scrollToBottomNow = React.useCallback((animated = false): void => {
    requestAnimationFrame(() => {
      const { contentHeight, layoutHeight } = scrollMetricsRef.current;
      if (contentHeight > 0 && layoutHeight > 0) {
        messageListRef.current?.scrollToOffset({
          offset: Math.max(0, contentHeight - layoutHeight),
          animated,
        });
        return;
      }
      messageListRef.current?.scrollToEnd({ animated });
    });
  }, []);
  const revealLatestMessage = React.useCallback((options?: { waitForLayout?: boolean; animated?: boolean }) => {
    const animated = options?.animated ?? true;
    setShowScrollToBottomButton(false);
    if (options?.waitForLayout) {
      pendingScrollToBottomRef.current = { animated };
      requestAnimationFrame(() => scrollToBottomNow(animated));
      return;
    }
    pendingScrollToBottomRef.current = null;
    scrollToBottomNow(animated);
  }, [scrollToBottomNow]);
  const handleScrollMetrics = React.useCallback((metrics: { y: number; contentHeight: number; layoutHeight: number }) => {
    scrollMetricsRef.current = metrics;
    const distanceFromBottom = metrics.contentHeight - metrics.layoutHeight - metrics.y;
    const isAtBottom = distanceFromBottom <= 64;

    if (pendingScrollToBottomRef.current) {
      const pending = pendingScrollToBottomRef.current;
      pendingScrollToBottomRef.current = null;
      setShowScrollToBottomButton(false);
      scrollToBottomNow(pending.animated);
      return;
    }

    if (isAtBottom) {
      setShowScrollToBottomButton(false);
      return;
    }

    setShowScrollToBottomButton(distanceFromBottom > 160);
  }, [scrollToBottomNow]);
  const canSend = useMemo(() => {
    const hasQuota = remainingChars === null ? true : remainingChars > 0;
    const { min: minInputChars, max: maxInputChars } = getChatGenerationInputLimits();
    const inputLength = countChatGenerationInputChars(inputText);
    return (
      !activeGenerationContactId &&
      !isTodaySyncing &&
      sttStatus === "idle" &&
      hasQuota &&
      inputLength >= minInputChars &&
      inputLength <= maxInputChars
    );
  }, [activeGenerationContactId, inputText, isTodaySyncing, remainingChars, sttStatus]);
  const showChatSendFailureAlert = React.useCallback((error?: { code?: string; stage?: "input" | "output" }) => {
    if (error?.code === "DAILY_QUOTA_EXCEEDED") {
      Alert.alert(isProEntitledRef.current ? t("chat.error.quota_member_empty") : t("chat.error.quota_free_empty"));
      return;
    }
    if (error?.code === "CONTENT_BLOCKED") {
      Alert.alert(error.stage === "output" ? t("chat.error.sensitive_output") : t("chat.error.sensitive_input"));
      return;
    }
    Alert.alert(t("chat.error.send_failed_retry"));
  }, []);
  const selectedDateKey = toDateKey(selectedDate);
  const isSelectedDateSyncing = syncingDateKey === selectedDateKey;
  const isAnotherContactGenerating = !!activeGenerationContactId && activeGenerationContactId !== contactId;
  const netInfo = useNetInfo();
  const historyContactIds = useMemo(
    () => Array.from(new Set((contact.historyContactIds?.length ? contact.historyContactIds : [contactId]).filter(Boolean))),
    [contact.historyContactIds, contactId],
  );
  const cancelActiveStt = React.useCallback((lastEvent: string): boolean => {
    if (sttStatusRef.current === "idle" && !sttSessionRef.current && !sttAudioSourceRef.current) {
      return false;
    }
    sttGenerationRef.current += 1;
    void sttAudioSourceRef.current?.stop();
    sttAudioSourceRef.current = null;
    sttSessionRef.current?.close();
    sttSessionRef.current = null;
    sttStatusRef.current = "idle";
    setSttStatus("idle");
    return true;
  }, []);
  const applyInputText = React.useCallback((
    text: string,
    options?: { source?: "user" | "stt" | "load" | "system"; preserveSelectionOverride?: boolean },
  ) => {
    inputTextRef.current = text;
    if (options?.source === "user") {
      cancelActiveStt("input edited");
    }
    if (!options?.preserveSelectionOverride) {
      setComposerSelectionOverride(null);
    }
    setInputText(text);
  }, [cancelActiveStt]);

  useEffect(() => {
    contactIdRef.current = contactId;
  }, [contactId]);

  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);

  
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
      if (draftLoadedContactRef.current === contactIdRef.current) {
        void saveChatInputDraft(contactIdRef.current, inputTextRef.current).catch(() => {});
      }
      dictionaryAbortRef.current?.abort();
      dictionaryAbortRef.current = null;
      sttGenerationRef.current += 1;
      void sttAudioSourceRef.current?.stop();
      sttAudioSourceRef.current = null;
      sttSessionRef.current?.close();
      sttSessionRef.current = null;
      stopTtsAudio({ resetControls: true });
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

  useEffect(() => {
    sttStatusRef.current = sttStatus;
  }, [sttStatus]);

  useEffect(() => {
    let cancelled = false;
    getUserPreference()
      .then((preference) => {
        if (!cancelled) {
          sttMultilingualRecognitionEnabledRef.current = preference.sttMultilingualRecognitionEnabled === true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          sttMultilingualRecognitionEnabledRef.current = false;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  useEffect(() => {
    let cancelled = false;
    draftLoadedContactRef.current = null;
    applyInputText("", { source: "load" });
    void loadChatInputDraft(contactId).then((draft) => {
      if (cancelled || !isMountedRef.current) return;
      draftLoadedContactRef.current = contactId;
      applyInputText(draft, { source: "load" });
    });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  useEffect(() => {
    if (draftLoadedContactRef.current !== contactId) return;
    const timer = setTimeout(() => {
      void saveChatInputDraft(contactId, inputText).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [contactId, inputText]);

  const refreshEntitlementSnapshot = React.useCallback(async (): Promise<void> => {
    if (!(await hasLocalProAccess())) {
      if (!isMountedRef.current) return;
      setRemainingChars(null);
      setIsProEntitled(false);
      return;
    }

    const entitlement = await getCurrentEntitlement().catch(() => null);
    if (!isMountedRef.current) return;
    setRemainingChars(entitlement?.remainingChars ?? null);
    setIsProEntitled((entitlement?.features?.highQualityTts ?? entitlement?.isMember ?? entitlement?.isPro) === true);
  }, []);

  // 启动初始化：加载本地权益快照，用于额度和 Pro 历史同步开关。
  useEffect(() => {
    void refreshEntitlementSnapshot();
  }, [refreshEntitlementSnapshot]);

  // 本地历史：进入聊天页或切换联系人时加载当前日期；日期切换入口会自行加载，避免同一天重复读本地缓存。
  useEffect(() => {
    let cancelled = false;
    async function bootstrapLocal() {
      const dateKey = toDateKey(selectedDate);
      const storedDateKeys = await listStoredChatDateKeysForHistory();
      if (!cancelled) {
        setLocalDateKeys(new Set(storedDateKeys));
      }
      const byDay = toDisplayRows(await loadChatMessagesByDateForHistory(dateKey));
      if (cancelled) return;
      dayLoadedRowsRef.current[dateKey] = byDay;
      setDayMessages(byDay);
      setMessages(byDay);
    }
    void bootstrapLocal();
    return () => {
      cancelled = true;
    };
  }, [contactId, historyContactIds.join(",")]);

  // 生成会话订阅：接收流式改写状态和消息列表更新。
  useEffect(() => {
    return subscribeChatSession(contactId, (snapshot) => {
      setIsSending(snapshot.isSending);
      if (snapshot.conversationId) setConversationId(snapshot.conversationId);
      if (!snapshot.changedDateKey || snapshot.changedDateKey !== toDateKey(selectedDate)) return;
      void (async () => {
        const byDay = toDisplayRows(await loadChatMessagesByDateForHistory(toDateKey(selectedDate)));
        setDayMessages(byDay);
        setMessages(byDay);
      })();
    });
  }, [contactId, historyContactIds.join(","), selectedDate]);

  useEffect(() => {
    return subscribeChatGenerationActivity((snapshot) => {
      setActiveGenerationContactId(snapshot.activeContactId);
    });
  }, []);

  useEffect(() => {
    const activeAssistantClientIds = getActiveAssistantClientIds();
    const inactivePendingCreatedAt = dayMessages
      .filter(
        (row) =>
          row.role === "assistant" &&
          row.status === "pending" &&
          !activeAssistantClientIds.has(row.clientId)
      )
      .map((row) => Date.parse(row.createdAt))
      .filter(Number.isFinite);
    if (!inactivePendingCreatedAt.length) return;

    const nextCleanupAt = Math.min(...inactivePendingCreatedAt) + INACTIVE_ASSISTANT_PLACEHOLDER_GRACE_MS;
    const timer = setTimeout(() => {
      void (async () => {
        const dateKey = toDateKey(selectedDate);
        const byDay = toDisplayRows(await loadChatMessagesByDateForHistory(dateKey));
        if (!isMountedRef.current || selectedDateKeyRef.current !== dateKey) return;
        setDayMessages(byDay);
        setMessages(byDay);
      })();
    }, Math.max(0, nextCleanupAt - Date.now()) + 50);

    return () => clearTimeout(timer);
  }, [activeGenerationContactId, dayMessages, selectedDate, historyContactIds.join(",")]);

  // 启动同步：进入聊天页后静默同步今天，兼顾多端新增消息。
  useEffect(() => {
    const activity = getChatGenerationActivitySnapshot();
    if (activity.activeContactId === contactId) {
      return;
    }
    void (async () => {
      const todayKey = await getBusinessDateKey();
      if (isMountedRef.current) setBusinessTodayKey(todayKey);
      const businessTodayDate = dateKeyToDate(todayKey);
      await syncDateQuietly(businessTodayDate, { force: true });
    })();
  }, []);

  // 日期面板：打开日历时预加载当前月份云端有记录的日期。
  useEffect(() => {
    if (!isDateSheetOpen) {
      return;
    }
    void preloadCloudMonthDateKeys(monthCursor);
  }, [isDateSheetOpen, monthCursor]);

  const handleCopyMessage = React.useCallback(
    (message: ChatMessage, mode: AutoCopyMode) => {
      void copyAssistantTaggedText(message.text, mode, false);
    },
    [contact.id]
  );

  const handleSelectionRefChange = React.useCallback((ref: SelectableMessageTextRef | null) => {
    if (ref) {
      messageTextTouchActiveRef.current = true;
    }
    activeSelectionRef.current = ref;
  }, []);
  const clearActiveSelection = React.useCallback(() => {
    activeSelectionRef.current?.clearSelection();
    activeSelectionRef.current = null;
  }, []);
  const handleScrollBeginDrag = React.useCallback(() => {
    Keyboard.dismiss();
  }, []);
  const prepareForCommand = React.useCallback((options?: { closeCopyMenu?: boolean }) => {
    commandTouchActiveRef.current = true;
    if (options?.closeCopyMenu !== false) {
      closeCopyMenuRef.current?.();
    }
    clearActiveSelection();
    Keyboard.dismiss();
  }, [clearActiveSelection]);
  const handleMessageTextInteractionStart = React.useCallback(() => {
    messageTextTouchActiveRef.current = true;
    closeCopyMenuRef.current?.();
    Keyboard.dismiss();
  }, []);
  const handleRootTouchEnd = React.useCallback(() => {
    setTimeout(() => {
      const startedOnMessageText = messageTextTouchActiveRef.current;
      const startedOnCommand = commandTouchActiveRef.current;
      messageTextTouchActiveRef.current = false;
      commandTouchActiveRef.current = false;
      if (!startedOnCommand && activeCopyMenuRef.current) {
        closeCopyMenuRef.current?.();
      }
      if (!startedOnMessageText && !startedOnCommand && activeSelectionRef.current) {
        clearActiveSelection();
      }
    }, 0);
  }, [clearActiveSelection]);
  const handleCopyMenuStateChange = React.useCallback((state: { isOpen: boolean; close: () => void }) => {
    activeCopyMenuRef.current = state.isOpen;
    closeCopyMenuRef.current = state.close;
  }, []);
  const handleComposerFocus = React.useCallback(() => {
    setInputProtectionActive(true);
    closeCopyMenuRef.current?.();
    clearActiveSelection();
  }, [clearActiveSelection]);
  const handleComposerBlur = React.useCallback(() => {
    setInputProtectionActive(false);
  }, []);
  const closeDictionaryLookup = React.useCallback(() => {
    dictionaryAbortRef.current?.abort();
    dictionaryAbortRef.current = null;
    setDictionaryLookup(null);
  }, []);
  const stopRealtimeStt = React.useCallback(async (options?: { discardPartial?: boolean }) => {
    if (sttStatusRef.current === "idle" || sttStatusRef.current === "stopping") return;
    const generation = sttGenerationRef.current + 1;
    sttGenerationRef.current = generation;
    sttStatusRef.current = "stopping";
    setSttStatus("stopping");
    const source = sttAudioSourceRef.current;
    sttAudioSourceRef.current = null;
    await source?.stop().catch((error) => {
      console.warn("stt audio source stop failed", error);
    });
    const session = sttSessionRef.current;
    if (options?.discardPartial) {
      applyInputText(sttDraftBaseRef.current, { source: "system" });
    }
    sttSessionRef.current = null;
    session?.close();
    if (!isMountedRef.current || sttGenerationRef.current !== generation) return;
    sttStatusRef.current = "idle";
    setSttStatus("idle");
  }, [applyInputText]);
  const handleSttPress = React.useCallback(async (context: ChatComposerSttPressContext) => {
    if (sttStatusRef.current === "stopping") {
      return;
    }
    if (sttStatusRef.current !== "idle") {
      await stopRealtimeStt();
      return;
    }
    if (netInfo.isConnected !== true) {
      Alert.alert(t("chat.error.network_send"));
      return;
    }
    if (activeGenerationContactId) {
      Alert.alert(t("chat.error.other_generating"));
      return;
    }

    sttStatusRef.current = "connecting";
    setSttStatus("connecting");
    const generation = sttGenerationRef.current + 1;
    sttGenerationRef.current = generation;
    const sttPlan = resolveSttRecognitionPlan(
      getLanguage(),
      sttMultilingualRecognitionEnabledRef.current
    );
    closeCopyMenuRef.current?.();
    clearActiveSelection();
    stopTtsAudio({ resetControls: true });

    const source = createPicovoiceRealtimeAudioSource();
    const hasPermission = await source.requestPermission().catch(() => false);
    if (sttGenerationRef.current !== generation) {
      await source.stop().catch(() => {});
      return;
    }
    if (!hasPermission) {
      sttStatusRef.current = "idle";
      setSttStatus("idle");
      Alert.alert(t("stt.permission.title"), t("stt.permission.message"));
      return;
    }

    const currentInputText = inputTextRef.current;
    const selectionStart = Math.max(0, Math.min(context.selection.start, context.selection.end, currentInputText.length));
    const selectionEnd = Math.max(0, Math.min(Math.max(context.selection.start, context.selection.end), currentInputText.length));
    sttDraftBaseRef.current = currentInputText;
    sttInsertRangeRef.current = { start: selectionStart, end: selectionEnd };
    sttFinalTextRef.current = "";
    sttPartialTextRef.current = "";
    const languageIdMode = sttPlan.languageIdMode;
    const candidateLanguages = sttPlan.candidateLanguages;

    const frameLength = 512;
    const bufferedFrames: PcmAudioFrame[] = [];
    const sendOrBufferFrame = (frame: PcmAudioFrame) => {
      if (sttGenerationRef.current !== generation) return;
      const session = sttSessionRef.current;
      if (session) {
        session.sendFrame(frame);
      } else {
        bufferedFrames.push({
          ...frame,
          pcm: Int16Array.from(frame.pcm),
        });
        if (bufferedFrames.length > STT_PREBUFFER_MAX_FRAMES) {
          bufferedFrames.shift();
        }
      }
    };

    try {
      sttAudioSourceRef.current = source;
      await source.start({
        sampleRate: 16000,
        frameLength,
        onFrame: sendOrBufferFrame,
        onError: (error) => {
          if (sttGenerationRef.current !== generation) return;
          console.warn("stt audio source failed", error);
          void stopRealtimeStt();
        },
      });
      if (sttGenerationRef.current !== generation) {
        await source.stop().catch(() => {});
        return;
      }

      const session = await openRealtimeSttSession({
        frameLength,
        languageIdMode,
        candidateLanguages,
        onEvent: (event) => {
          if (!isMountedRef.current || sttGenerationRef.current !== generation) return;
          if (event.type === "ready") {
            sttStatusRef.current = "recording";
            setSttStatus("recording");
            return;
          }
          if (event.type === "partial") {
            const finalText = event.finalText ?? sttFinalTextRef.current;
            sttPartialTextRef.current = event.text;
            const merged = mergeSttDraftResult(sttDraftBaseRef.current, finalText, event.text, sttInsertRangeRef.current);
            applyInputText(merged.text, { source: "stt", preserveSelectionOverride: true });
            setComposerSelectionOverride(merged.selection);
            return;
          }
          if (event.type === "final") {
            sttFinalTextRef.current = event.finalText ?? mergeSttDraft("", sttFinalTextRef.current, event.text);
            sttPartialTextRef.current = "";
            const merged = mergeSttDraftResult(sttDraftBaseRef.current, sttFinalTextRef.current, "", sttInsertRangeRef.current);
            applyInputText(merged.text, { source: "stt", preserveSelectionOverride: true });
            setComposerSelectionOverride(merged.selection);
            return;
          }
          if (event.type === "done") {
            sttFinalTextRef.current = event.text || sttFinalTextRef.current;
            const merged = mergeSttDraftResult(
              sttDraftBaseRef.current,
              sttFinalTextRef.current || sttPartialTextRef.current,
              "",
              sttInsertRangeRef.current
            );
            applyInputText(merged.text, { source: "stt", preserveSelectionOverride: true });
            setComposerSelectionOverride(merged.selection);
            sttPartialTextRef.current = "";
            sttSessionRef.current = null;
            sttStatusRef.current = "idle";
            setSttStatus("idle");
            return;
          }
          if (event.type === "error" || event.type === "canceled") {
            console.warn("stt event", event);
            void stopRealtimeStt();
            showNotice({
              message: t("stt.error.session_failed"),
              type: "warning",
              position: "top-right",
              durationMs: 1800,
            });
          }
        },
        onError: (error) => {
          console.warn("stt session failed", error);
          if (!isMountedRef.current || sttGenerationRef.current !== generation) return;
          void stopRealtimeStt();
          showNotice({
            message: t("stt.error.session_failed"),
            type: "warning",
            position: "top-right",
            durationMs: 1800,
          });
        },
        onClose: () => {
          if (!isMountedRef.current || sttGenerationRef.current !== generation) return;
          sttSessionRef.current = null;
          sttStatusRef.current = "idle";
          setSttStatus("idle");
        },
      });
      if (sttGenerationRef.current !== generation || isSttInactive(sttStatusRef.current)) {
        session.close();
        return;
      }
      sttSessionRef.current = session;
      for (const frame of bufferedFrames) {
        session.sendFrame(frame);
      }
      bufferedFrames.length = 0;
    } catch (error) {
      console.warn("stt start failed", error);
      await source.stop().catch(() => {});
      if (sttGenerationRef.current !== generation) return;
      sttAudioSourceRef.current = null;
      sttSessionRef.current?.close();
      sttSessionRef.current = null;
      sttStatusRef.current = "idle";
      setSttStatus("idle");
      showNotice({
        message: t("stt.error.session_failed"),
        type: "warning",
        position: "top-right",
        durationMs: 1800,
      });
    }
  }, [activeGenerationContactId, applyInputText, clearActiveSelection, netInfo.isConnected, showNotice, stopRealtimeStt]);
  const handleComposerTextChange = React.useCallback((text: string) => {
    applyInputText(text, { source: "user" });
  }, [applyInputText]);
  const handleDictionarySelection = React.useCallback(
    (message: ChatMessage, payload: NativeTextSelectionPayload, clearSelection: () => void) => {
      const term = payload.selectedText.trim();
      if (!term) return;
      closeCopyMenuRef.current?.();
      Keyboard.dismiss();
      clearSelection();

      dictionaryAbortRef.current?.abort();
      const controller = new AbortController();
      dictionaryAbortRef.current = controller;
      const requestSeq = dictionaryRequestSeqRef.current + 1;
      dictionaryRequestSeqRef.current = requestSeq;
      const messageId = message.id ?? message.serverId ?? null;
      const textStart = payload.start;
      const textEnd = payload.end;

      setDictionaryLookup({
        term,
        messageId,
        textStart,
        textEnd,
        anchor: payload.selectionRect,
        loading: true,
        error: null,
        result: null,
      });

      void (async () => {
        const fallbackPreference = message.languageCode ? null : await getUserPreference().catch(() => null);
        const result = await lookupDictionary({
          term,
          context: message.text,
          selectionStart: textStart,
          selectionEnd: textEnd,
          targetLanguage: message.languageCode ?? fallbackPreference?.learningLanguage ?? "en-US",
          uiLanguage: getLanguage(),
          contactId,
          messageId,
          signal: controller.signal,
        });
        return result;
      })().then((result) => {
        if (!isMountedRef.current || controller.signal.aborted || dictionaryRequestSeqRef.current !== requestSeq) return;
        setDictionaryLookup((current) => current && current.textStart === textStart && current.textEnd === textEnd
          ? { ...current, loading: false, result, error: null }
          : current);
      }).catch((error) => {
        if (!isMountedRef.current || controller.signal.aborted || dictionaryRequestSeqRef.current !== requestSeq) return;
        console.warn("dictionary lookup failed", error);
        setDictionaryLookup((current) => current
          ? { ...current, loading: false, error: t("dictionary.error.failed") }
          : current);
      }).finally(() => {
        if (dictionaryAbortRef.current === controller) {
          dictionaryAbortRef.current = null;
        }
      });
    },
    [contactId],
  );

  async function listStoredChatDateKeysForHistory(): Promise<string[]> {
    const all = await Promise.all(historyContactIds.map((sourceContactId) => listStoredChatDateKeys(sourceContactId)));
    return Array.from(new Set(all.flat())).sort();
  }

  async function loadChatMessagesByDateForHistory(dateKey: string): Promise<ChatMessage[]> {
    const activeAssistantClientIds = getActiveAssistantClientIds();
    const groups = await Promise.all(historyContactIds.map(async (sourceContactId) => {
      const rows = await loadChatMessagesByDate(sourceContactId, dateKey);
      const cleaned = removeInactiveAssistantPlaceholders(rows, activeAssistantClientIds);
      if (cleaned.length !== rows.length) {
        await replaceChatMessagesByDate(sourceContactId, dateKey, cleaned);
      }
      return cleaned.map((row) => ({ ...row, contactId: row.contactId ?? sourceContactId }));
    }));
    return mergeMessageRows(groups.flat());
  }

  function mergeMessageRows(rows: ChatMessage[]): ChatMessage[] {
    const map = new Map<string, ChatMessage>();
    for (const row of rows) {
      const key = `${row.contactId ?? contactId}:${row.serverId ?? row.clientId ?? row.id ?? row.localId}`;
      map.set(key, row);
    }
    return Array.from(map.values()).sort(compareChatMessagesByCreatedAt);
  }

  async function handleSend(): Promise<void> {
    if (netInfo.isConnected !== true) {
      Alert.alert(t("chat.error.network_send"));
      return;
    }
    const text = inputText.trim();
    if (!text || activeGenerationContactId) return;
    const { min: minInputChars, max: maxInputChars } = getChatGenerationInputLimits();
    const inputLength = countChatGenerationInputChars(text);
    if (inputLength < minInputChars) {
      Alert.alert(tf("chat.error.min_chars", { count: minInputChars }))
      return;
    }
    if (inputLength > maxInputChars) {
      Alert.alert(tf("chat.error.max_chars", { count: maxInputChars }))
      return;
    }
    if (isTodaySyncingRef.current) {
      Alert.alert(t("chat.error.syncing_send"))
      return;
    }
    if (remainingChars !== null && remainingChars <= 0) {
      showChatSendFailureAlert({ code: "DAILY_QUOTA_EXCEEDED" });
      return;
    }

    const businessTodayKey = await getBusinessDateKey().catch(() => null);
    if (!businessTodayKey) {
      Alert.alert(t("chat.error.network_send"));
      return;
    }
    setBusinessTodayKey(businessTodayKey);
    const isViewingToday = toDateKey(selectedDate) === businessTodayKey;
    const businessTodayDate = dateKeyToDate(businessTodayKey);

    if (!isViewingToday) {
      setSelectedDate(businessTodayDate);
      setMonthCursor(new Date(businessTodayDate.getFullYear(), businessTodayDate.getMonth(), 1));
      void syncDateQuietly(businessTodayDate, { force: true });
    }

    applyInputText("", { source: "system" });
    await clearChatInputDraft(contactId).catch(() => {});
    Keyboard.dismiss();
    setIsSending(true);

    // 乐观更新
    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalChatPair(
      text,
      new Date(),
      businessTodayKey
    );
    userLocal.contactId = contactId;
    assistantLocal.contactId = contactId;
    const todayRows = isViewingToday ? dayMessages : toDisplayRows(await loadChatMessagesByDateForHistory(businessTodayKey));
    const localNextRaw = [...todayRows, userLocal, assistantLocal];
    const localNext = toDisplayRows(localNextRaw);
    setDayMessages(localNext);
    setMessages(localNext);
    await appendChatMessages(contactId, [userLocal, assistantLocal]); // 写入本地缓存
    setLocalDateKeys((prev) => new Set([...prev, businessTodayKey])); // 合并datekey
    revealLatestMessage({ waitForLayout: true });

    startChatSession({
      contactId,
      text,
      userClientId: userLocal.clientId,
      assistantClientId: assistantLocal.clientId,
      conversationDateKey: businessTodayKey,
      retryCount: 0,
      companionMode,
      conversationId,
      onStreamDone: () => {
        if (!isMountedRef.current) return;
        void syncDateQuietly(businessTodayDate, { force: true });
        void refreshEntitlementSnapshot();
      },
      onFailure: showChatSendFailureAlert,
    });
  }

  async function handleRetryMessage(message: ChatMessage): Promise<void> {
    const text = message.retryText?.trim();
    if (!text || activeGenerationContactId || (message.retryCount ?? 0) >= 1) return;
    if (remainingChars !== null && remainingChars <= 0) {
      showChatSendFailureAlert({ code: "DAILY_QUOTA_EXCEEDED" });
      return;
    }

    Keyboard.dismiss();
    setIsSending(true);
    const businessTodayKey = await getBusinessDateKey().catch(() => null);
    if (!businessTodayKey) {
      setIsSending(false);
      Alert.alert(t("chat.error.network_send"));
      return;
    }
    setBusinessTodayKey(businessTodayKey);
    const retryCount = (message.retryCount ?? 0) + 1;
    const retryDateKey = message.conversationDateKey ?? businessTodayKey;
    const retryDate = dateKeyToDate(retryDateKey);
    const { userMessage: userLocal, assistantMessage: assistantLocal } = createLocalChatPair(
      text,
      new Date(),
      retryDateKey
    );
    userLocal.contactId = contactId;
    assistantLocal.contactId = contactId;
    const localNext = [...dayMessages, userLocal, assistantLocal];
    setDayMessages(localNext);
    setMessages(toDisplayRows(localNext));
    await appendChatMessages(contactId, [userLocal, assistantLocal]);
    setLocalDateKeys((prev) => new Set([...prev, retryDateKey]));
    revealLatestMessage({ waitForLayout: true });

    startChatSession({
      contactId,
      text,
      userClientId: userLocal.clientId,
      assistantClientId: assistantLocal.clientId,
      conversationDateKey: retryDateKey,
      retryCount,
      companionMode,
      systemPrompt: message.retrySystemPrompt,
      conversationId,
      onStreamDone: () => {
        if (!isMountedRef.current) return;
        void syncDateQuietly(retryDate, { force: true });
        void refreshEntitlementSnapshot();
      },
      onFailure: showChatSendFailureAlert,
    });
  }

  async function preloadCloudMonthDateKeys(cursor: Date): Promise<void> {
    if (!(await hasLocalProAccess())) return;

    const { monthKey, fromDateKey, toDateKey: monthEndDateKey } = getMonthRange(cursor);
    if (loadedCloudMonthKeysRef.current.has(monthKey)) {
      return;
    }
    
    // 月索引和 day 同步是两条业务线，但 notice 仍共用一个入口，后来的提示会顶掉前面的。
    const { token, controller } = calendarSyncMachine.begin("chat_calendar", monthKey);
    // 日历同步只顶掉上一轮日历同步；notice 单通道另行处理，不取消消息同步。
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "calendar" as const,
      ...showNotice({
        message: t("chat.notice.calendar_syncing"),
        type: "info",
        position: "top-right",
        durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;

    try {
      calendarSyncMachine.setPhase(token, "fetching");
      loadedCloudMonthKeysRef.current.add(monthKey);
      const keySets = await Promise.all(historyContactIds.map((sourceContactId) => listConversationDateKeysFromCloud({
        contactId: sourceContactId,
        fromDateKey,
        toDateKey: monthEndDateKey,
        signal: controller.signal,
      })));
      const keys = new Set<string>();
      keySets.forEach((set) => set.forEach((key) => keys.add(key)));
      if (!isMountedRef.current) return;
      calendarSyncMachine.setPhase(token, "merging");
      setCloudDateKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.add(key));
        return next;
      });
      if (isDateSheetOpen && syncNoticeRef.current === notice) {
        notice.update({
          message: t("chat.notice.calendar_updated"),
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
          message: t("chat.notice.calendar_failed"),
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
    const todayKey = await getBusinessDateKey().catch(() => null);
    if (!todayKey) return resolved ?? null;
    const fallback = dateKey === todayKey ? conversationId : null;
    const finalId = resolved ?? fallback ?? null;
    if (isMountedRef.current && finalId && finalId !== conversationId) {
      setConversationId(finalId);
    }
    return finalId;
  }

  function mapCloudRows(
    rows: Array<Awaited<ReturnType<typeof listDayMessagesFromCloud>>[number] & { contactId?: string | null }>
  ): ChatMessage[] {
    return rows.map((row) => ({
      id: row.id,
      serverId: row.id,
      clientId: row.clientId ?? `cloud-${row.id}`,
      localId: row.clientId ?? `cloud-${row.id}`,
      role: row.role,
      text: row.content,
      time: new Date(row.createdAt).toTimeString().slice(0, 5),
      createdAt: row.createdAt,
      conversationDateKey: row.conversationDateKey ?? null,
      languageCode: row.languageCode ?? null,
      status: row.status,
      clozeState: row.clozeState ?? null,
      clozeVersion: row.clozeVersion ?? 0,
      clozePracticeDiscardedAt: row.clozePracticeDiscardedAt ?? null,
      contactId: row.contactId ?? contactId,
    }));
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
  });

  async function syncDayFromCloud(
    d: Date,
    options?: { force?: boolean; signal?: AbortSignal; syncToken?: number }
  ): Promise<{ synced: boolean; changed: boolean }> {
    const mergeCloudAndLocal = (cloudRows: ChatMessage[], localRows: ChatMessage[]): ChatMessage[] => {
      const getMessageKeys = (row: ChatMessage): string[] =>
        [row.serverId, row.clientId, row.id, row.localId].filter((value): value is string => Boolean(value));
      const merged = [...cloudRows];
      const cloudKeys = new Set(cloudRows.flatMap(getMessageKeys));
      const activeAssistantClientIds = getActiveAssistantClientIds();
      const pendingAssistants = removeInactiveAssistantPlaceholders(localRows, activeAssistantClientIds).filter(
        (row) =>
          row.role === "assistant" &&
          row.status === "pending" &&
          !getMessageKeys(row).some((key) => cloudKeys.has(key))
      );
      if (pendingAssistants.length) {
        merged.push(...pendingAssistants);
      }
      return toDisplayRows(merged).sort(compareChatMessagesByCreatedAt);
    };
    const localPro = await hasLocalProAccess();
    const [session, entitlement] = await Promise.all([
      getSession(),
      localPro ? getCurrentEntitlement().catch(() => null) : Promise.resolve(null),
    ]);
    const userId = entitlement?.userId ?? session?.user?.id ?? "mock_user_001";
    const canCloudSync = (entitlement?.features?.cloudSync ?? entitlement?.isMember ?? entitlement?.isPro) === true;
    if (!isMountedRef.current) return { synced: false, changed: false };
    setIsProEntitled((entitlement?.features?.highQualityTts ?? entitlement?.isMember ?? entitlement?.isPro) === true);
    const dateKey = toDateKey(d);
    const reqId = ++syncSeqRef.current;
    latestSyncReqByDateRef.current[dateKey] = reqId;
    // 同一天 5 分钟内只允许命中一次拉取，避免进出页面时反复打云端。
    const dirty = consumeChatDateDirty(contactId, dateKey);
    const lastSyncedAt = lastCloudSyncAtByDateRef.current[dateKey] ?? 0;
    if (!options?.force && !dirty && Date.now() - lastSyncedAt <= 5 * 60 * 1000) {
      return { synced: true, changed: false };
    }

    if (!canCloudSync) return { synced: false, changed: false };

    // 这里只推进 day 业务状态，不负责弹什么提示；提示逻辑在 syncDateQuietly 里统一做。
    if (options?.syncToken) {
      daySyncMachine.setPhase(options.syncToken, "checking");
    }
    const cachedLoaded = toDisplayRows(await loadChatMessagesByDateForHistory(dateKey)).sort(compareChatMessagesByCreatedAt);
    let resolvedConversationId = await resolveConversationIdForDate(dateKey, options?.signal);
    if (!isMountedRef.current) return { synced: false, changed: false };

    if (options?.syncToken) {
      daySyncMachine.setPhase(options.syncToken, "fetching");
    }
    const cloudRowsByContact = await Promise.all(historyContactIds.map(async (sourceContactId) => {
      const sourceConversationId = await findConversationIdByDateFromCloud({
        dateKey,
        contactId: sourceContactId,
        signal: options?.signal,
      });
      if (!sourceConversationId) return [];
      const rows = await listDayMessagesFromCloud({
        conversationId: sourceConversationId,
        userId,
        dateKey,
        signal: options?.signal,
      });
      return rows.map((row) => ({ ...row, contactId: sourceContactId }));
    }));
    let allRows = cloudRowsByContact.flat();
    if (!isMountedRef.current) return { synced: false, changed: false };
    if (latestSyncReqByDateRef.current[dateKey] !== reqId) return { synced: false, changed: false };

    const cloudClientIds = new Set(allRows.map((row) => row.clientId).filter((clientId): clientId is string => !!clientId));
    // 用户升级 Pro 后不在购买瞬间补云端；打开聊天同步当天时，先把成功的本地消息补到云端。
    // 这样云端当天还没建会话时，也不会被一次空云端同步覆盖掉本地历史。
    const unsyncedLocalRows = cachedLoaded.filter(
      (row) =>
        row.status === "success" &&
        (row.contactId === contactId || !row.contactId) &&
        !row.serverId &&
        !!row.clientId &&
        !row.clientId.startsWith("cloud-") &&
        !cloudClientIds.has(row.clientId) &&
        row.text.trim().length > 0
    );
    if (unsyncedLocalRows.length > 0) {
      if (options?.syncToken) {
        daySyncMachine.setPhase(options.syncToken, "merging");
      }
      const imported = await importLocalDayMessagesToCloud({
        contactId,
        dateKey,
        messages: unsyncedLocalRows.map((row) => ({
          clientId: row.clientId,
          role: row.role,
          status: "success",
          content: row.text,
          createdAt: row.createdAt,
          clozeState: row.role === "assistant" ? row.clozeState ?? null : null,
          clozeVersion: row.role === "assistant" ? row.clozeVersion ?? 0 : 0,
          clozePracticeDiscardedAt: row.role === "assistant" ? row.clozePracticeDiscardedAt ?? null : null,
          languageCode: row.role === "assistant" ? row.languageCode ?? null : null,
        })),
      });
      resolvedConversationId = imported.conversationId;
      if (isMountedRef.current && resolvedConversationId !== conversationId) {
        setConversationId(resolvedConversationId);
      }
      allRows = [
        ...cloudRowsByContact.flat().filter((row) => row.contactId !== contactId),
        ...(await listDayMessagesFromCloud({
          conversationId: resolvedConversationId,
          userId,
          dateKey,
          signal: options?.signal,
        })).map((row) => ({ ...row, contactId })),
      ];
      if (!isMountedRef.current) return { synced: false, changed: false };
      if (latestSyncReqByDateRef.current[dateKey] !== reqId) return { synced: false, changed: false };
    }

    if (!resolvedConversationId && allRows.length === 0) return { synced: false, changed: false };

    if (options?.syncToken) {
      daySyncMachine.setPhase(options.syncToken, "merging");
    }
    const visibleMapped = toDisplayRows(mapCloudRows(allRows)).sort(compareChatMessagesByCreatedAt);
    setCloudDateKeys((prev) => {
      const next = new Set(prev);
      next.add(dateKey);
      return next;
    });

    const dayKey = dateKey;
    let nextVisibleDay = visibleMapped;
    nextVisibleDay = mergeCloudAndLocal(nextVisibleDay, cachedLoaded);
    if (!options?.force && nextVisibleDay.length < cachedLoaded.length) {
      nextVisibleDay = cachedLoaded;
    }
    const previousVisibleDay = toDisplayRows(await loadChatMessagesByDateForHistory(dayKey)).sort(compareChatMessagesByCreatedAt);
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
    //---test cost----
    //const start = performance.now();

    const dateKey = toDateKey(d);
    const dirty = consumeChatDateDirty(contactId, dateKey);
    const lastSyncedAt = lastCloudSyncAtByDateRef.current[dateKey] ?? 0;
    if (!options?.force && !dirty && Date.now() - lastSyncedAt <= 5 * 60 * 1000) {
      return;
    }

    const { token, controller } = daySyncMachine.begin("chat_day", dateKey);
    const businessTodayKey = await getBusinessDateKey().catch(() => null);
    if (!businessTodayKey) {
      daySyncMachine.settle(token);
      return;
    }
    const isTodaySync = dateKey === businessTodayKey;
    if (isTodaySync) {
      setIsTodaySyncing(true);
    }
    setSyncingDateKey(dateKey);

    // notice 是一条单独的 UI 通道，不看业务分类，谁后发谁顶掉前面的。
    syncNoticeRef.current?.hide();
    const notice = {
      kind: "messages" as const,
      ...showNotice({
      message: t("chat.notice.messages_syncing"),
      type: "info",
      position: "top-right",
      durationMs: 0,
      }),
    };
    syncNoticeRef.current = notice;
    try {
      daySyncMachine.setPhase(token, "fetching");
      const result = await syncDayFromCloud(d, { ...options, force: options?.force || dirty, signal: controller.signal, syncToken: token });
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
        message: t("chat.notice.messages_updated"),
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
        message: t("chat.notice.sync_failed"),
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

      //const end = performance.now();
      //console.log(`同步消息耗时: ${(end - start).toFixed(1)}ms`);
    }
  }

  async function handleSelectDate(d: Date): Promise<void> {
    Keyboard.dismiss();
    setSelectedDate(d);
    setIsDateSheetOpen(false);
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));

    const visibleLocalRows = toDisplayRows(await loadChatMessagesByDateForHistory(toDateKey(d)));
    setDayMessages(visibleLocalRows);
    setMessages(visibleLocalRows);

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
      <ChatContentFrame onAndroidTouchEnd={handleRootTouchEnd}>
        <ChatHeader
          contact={contact}
          onBack={onBack}
          onOpenCalendar={() => {
            prepareForCommand();
            setIsDateSheetOpen(true);
          }}
          onOpenMenu={canConfigureCompanionMode
            ? () => {
                prepareForCommand();
                openAutoCopyMenu();
              }
            : undefined}
        />
        <TtsMiniPlayer storageKey="linguaflow.tts_mini_player.chat.v1" />

        <MessageList
          contact={contact}
          messages={messages}
          selectedDateLabel={selectedDateLabelText(selectedDate, businessTodayKey ?? undefined)}
          canUseTts={isProEntitled}
          listRef={messageListRef}
          inputProtectionActive={inputProtectionActive}
          onMessageTextInteractionStart={handleMessageTextInteractionStart}
          onPrepareForCommand={prepareForCommand}
          onSelectionRefChange={handleSelectionRefChange}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollMetrics={handleScrollMetrics}
          onCopyMenuStateChange={handleCopyMenuStateChange}
          onRetryMessage={handleRetryMessage}
          onCopyMessage={handleCopyMessage}
          onTextSelection={handleTextSelection}
          onDictionarySelection={handleDictionarySelection}
          onEditClozeGroup={handleEditClozeGroup}
          onDeleteClozeGroup={handleDeleteClozeGroup}
        />

        {showScrollToBottomButton ? (
          <Pressable
            style={styles.scrollToBottomButton}
            hitSlop={10}
            onPress={() => {
              closeCopyMenuRef.current?.();
              clearActiveSelection();
              revealLatestMessage();
            }}
          >
            <Ionicons name="chevron-down" size={21} color="#111111" />
          </Pressable>
        ) : null}

        <ChatComposer
          value={inputText}
          onChangeText={handleComposerTextChange}
          onSend={handleSend}
          onStop={() => {}}
          onSttPress={handleSttPress}
          onFocus={handleComposerFocus}
          onBlur={handleComposerBlur}
          onDisabledPress={() => {
            if (isAnotherContactGenerating) {
              Alert.alert(t("chat.error.other_generating"))
              return;
            }
            if (isTodaySyncing) {
              Alert.alert(t("chat.error.syncing_send"))
              return;
            }
            if (remainingChars !== null && remainingChars <= 0) {
              showChatSendFailureAlert({ code: "DAILY_QUOTA_EXCEEDED" });
              return;
            }
            const inputLength = countChatGenerationInputChars(inputText);
            const { min: minInputChars, max: maxInputChars } = getChatGenerationInputLimits();
            if (inputLength > 0 && inputLength < minInputChars) {
              Alert.alert(tf("chat.error.min_chars", { count: minInputChars }))
              return;
            }
            if (inputLength > maxInputChars) {
              Alert.alert(tf("chat.error.max_chars", { count: maxInputChars }))
            }
          }}
          disabled={!canSend}
          isSending={isSending}
          sttStatus={sttStatus}
          inputEditable
          selectionOverride={composerSelectionOverride}
        />
      </ChatContentFrame>

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
        onEditDeleteTarget={handleEditClozeGroup}
        onLookupDeleteTarget={(message, payload) => {
          handleDictionarySelection(message, payload, () => setClozeDelete(null));
        }}
      />
      {canConfigureCompanionMode ? (
        <AutoCopySheet
          visible={isAutoCopyMenuOpen}
          contact={contact}
          companionMode={companionMode}
          onClose={closeAutoCopyMenu}
          onSelectCompanionMode={(mode) => {
            setCompanionMode(contactId, mode);
          }}
        />
      ) : null}
      <InfoDialog config={dialog} onClose={() => setDialog(null)} />
      <DictionaryPopover
        visible={!!dictionaryLookup}
        anchor={dictionaryLookup?.anchor}
        term={dictionaryLookup?.term ?? ""}
        loading={dictionaryLookup?.loading ?? false}
        error={dictionaryLookup?.error}
        result={dictionaryLookup?.result}
        messageId={dictionaryLookup?.messageId}
        textStart={dictionaryLookup?.textStart}
        textEnd={dictionaryLookup?.textEnd}
        canUseTts={isProEntitled}
        onClose={closeDictionaryLookup}
      />
    </SafeAreaView>
  );
}

function mergeSttDraft(
  base: string,
  finalText: string,
  partialText: string,
  range: { start: number; end: number } = { start: base.length, end: base.length },
): string {
  return mergeSttDraftResult(base, finalText, partialText, range).text;
}

function mergeSttDraftResult(
  base: string,
  finalText: string,
  partialText: string,
  range: { start: number; end: number } = { start: base.length, end: base.length },
): { text: string; selection: { start: number; end: number } } {
  const speech = [finalText.trim(), partialText.trim()].filter(Boolean).join(" ");
  if (!base) return { text: speech, selection: { start: speech.length, end: speech.length } };
  if (!speech) return { text: base, selection: { start: range.start, end: range.start } };
  const start = Math.max(0, Math.min(range.start, range.end, base.length));
  const end = Math.max(0, Math.min(Math.max(range.start, range.end), base.length));
  const before = base.slice(0, start);
  const after = base.slice(end);
  const prefix = before ? (/\s$/.test(before) ? "" : " ") : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  const text = `${before}${prefix}${speech}${suffix}${after}`;
  const cursor = before.length + prefix.length + speech.length;
  return { text, selection: { start: cursor, end: cursor } };
}

function resolveSttRecognitionPlan(appLocale: string, multilingualRecognitionEnabled: boolean): SttRecognitionPlan {
  if (multilingualRecognitionEnabled) {
    return {
      languageIdMode: "continuous",
      candidateLanguages: MULTILINGUAL_STT_LANGUAGES,
    };
  }
  return {
    languageIdMode: "at_start",
    candidateLanguages: [resolveDirectSttLanguage(appLocale)],
  };
}

function resolveDirectSttLanguage(appLocale: string): string {
  if (appLocale === "en-US") return "en-US";
  if (appLocale === "ja-JP") return "ja-JP";
  return "zh-CN";
}

function ChatContentFrame({
  children,
  onAndroidTouchEnd,
}: {
  children: React.ReactNode;
  onAndroidTouchEnd: () => void;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.content}
      behavior="height"
      onTouchEnd={Platform.OS === "android" ? onAndroidTouchEnd : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

function isSttInactive(status: "idle" | "connecting" | "recording" | "stopping"): boolean {
  return status === "idle" || status === "stopping";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },
  content: {
    flex: 1,
  },
  scrollToBottomButton: {
    position: "absolute",
    alignSelf: "center",
    bottom: 76,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#DBDFE7",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#111111",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
});
