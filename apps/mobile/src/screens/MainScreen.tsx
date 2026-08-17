import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  ActionSheetIOS,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import OioCharacter from "../../assets/app/oio-character.svg";
import { NestableDraggableFlatList, NestableScrollContainer, type RenderItemParams } from "react-native-draggable-flatlist";
import {
  createCardEntry,
  bootstrapCard,
  createCardCollection,
  deleteCardCollection,
  deleteCardRecord,
  getCardCollections,
  getCardRecordPage,
  getCardTaskStatus,
  getCardRecord,
  getCardCapabilities,
  updateCardContent,
  saveCardClozeUpdate,
  moveCardToCollection,
  moveCardsToCollection,
  moveCardCollection,
  renameCardCollection,
  reorderFavoriteCardCollection,
  setCardCollectionFavorite,
  CardApiError,
  deleteCardImageUpload,
  searchCardsLexically,
  DEFAULT_CARD_CAPABILITIES,
  type CardRecordSummary,
  type CardCollection,
  type CardCapabilities,
  type RecallCandidate,
} from "../services/api/cardApi";
import {
  loadCardDraft,
  saveCardDraft,
  type CardDraft,
  type CardDraftImage,
} from "../services/card/cardDraftStorage";
import { theme } from "../theme";
import { CardDetailModal } from "./CardDetailModal";
import type { CardDetailRequest } from "./CardDetailNavigator";
import {
  prepareCardDraftImage,
  removePersistentDraftImage,
  uploadCardDraftImage,
} from "../services/card/cardImageUpload";
import { generateMissingCardContent, isCardResourceLimitedError, type CardGenerationTarget } from "../services/card/cardContentGeneration";
import { isCardGenerationInProgress, isCardRecordGenerationInProgress, setCardGenerationState, subscribeCardGenerationState } from "../services/card/cardGenerationState";
import { getLanguage, t, tf } from "../i18n";
import { CollectionPickerModal } from "./shared/CollectionPickerModal";
import { CalendarSidebarPreview, CardCalendarScreen } from "./CardCalendarScreen";
import { getCurrentEntitlement, getUsageV2, getUserProfile, type CurrentEntitlement, type UserProfile } from "../services/api/meApi";
import { stabilizeProfileAvatar, stabilizeSignedImage } from "../services/image/signedImageCache";

type MainScreenProps = {
  isActive: boolean;
  refreshRevision: number;
  incomingCardDraft?: { id: number; draft: CardDraft } | null;
  onIncomingCardDraftHandled?: (id: number) => void;
  onOpenCard: (recordId: string, initialTab?: CardDetailRequest["initialTab"], origin?: CardDetailRequest["origin"]) => void;
  onOpenRecall: (mode?: "today" | "yesterday" | "blind") => void;
  onOpenAssistant: () => void;
  onOpenAccount: () => void;
};
type LibraryView = "all" | string;
type RecordActionAnchor = { x: number; y: number; width: number; height: number };

const UNCLASSIFIED_VIEW = "unclassified";
const EMPTY_DRAFT: CardDraft = { collectionId: null, title: "", text: "", rewrittenText: "", translationText: "", replyText: "", derivedFromText: "", clientId: null, recordId: null, submitted: false, clozeRanges: [], enabledLayers: { expression: false, translation: false, reply: false }, images: [] };
const COLLECTION_DRAG_ANIMATION = { damping: 24, mass: 0.12, stiffness: 260, overshootClamping: true } as const;
const COLLECTION_DRAG_SETTLE_GUARD_MS = 100;
const LIBRARY_PAGE_SIZE = 40;
const BACKGROUND_REFRESH_INTERVAL_MS = 60_000;
const TOPIC_REFRESH_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000] as const;

const THUMBNAIL_REFRESH_LEAD_MS = 60_000;
const THUMBNAIL_ERROR_REFRESH_COOLDOWN_MS = 10_000;

export function MainScreen({ isActive, refreshRevision, incomingCardDraft, onIncomingCardDraftHandled, onOpenCard, onOpenRecall, onOpenAssistant, onOpenAccount }: MainScreenProps) {
  const screenInsets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const [libraryView, setLibraryView] = useState<LibraryView>("all");
  const [sortMode, setSortMode] = useState<"newest" | "oldest">("newest");
  const [libraryMenuVisible, setLibraryMenuVisible] = useState(false);
  const [libraryMenuPage, setLibraryMenuPage] = useState<"main" | "sort">("main");
  const [selectingRecords, setSelectingRecords] = useState(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [batchMoveVisible, setBatchMoveVisible] = useState(false);
  const [cardCapabilities, setCardCapabilities] = useState<CardCapabilities>(DEFAULT_CARD_CAPABILITIES);
  const cardLimits = cardCapabilities.limits;
  const [records, setRecords] = useState<CardRecordSummary[]>([]);
  const recordsRef = useRef<CardRecordSummary[]>([]);
  const [collections, setCollections] = useState<CardCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<RecallCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchCollectionId, setSearchCollectionId] = useState<string | null | undefined>(undefined);
  const [composerVisible, setComposerVisible] = useState(false);
  const [collectionMoveVisible, setCollectionMoveVisible] = useState(false);
  const [collectionMoveTargetId, setCollectionMoveTargetId] = useState<string | null>(null);
  const [recordMoveTarget, setRecordMoveTarget] = useState<CardRecordSummary | null>(null);
  const [recordActionMenu, setRecordActionMenu] = useState<{ record: CardRecordSummary; anchor: RecordActionAnchor } | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [sidebarProfile, setSidebarProfile] = useState<UserProfile | null>(null);
  const sidebarProfileRef = useRef<UserProfile | null>(null);
  const [sidebarEntitlement, setSidebarEntitlement] = useState<CurrentEntitlement | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const draftRef = useRef<CardDraft>(EMPTY_DRAFT);
  const draftRevisionRef = useRef(0);
  const handledIncomingDraftIdRef = useRef(0);
  const [sending, setSending] = useState(false);
  const [preparingDraftImageCount, setPreparingDraftImageCount] = useState(0);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const pollStartedAtRef = useRef(Date.now());
  const refreshSequenceRef = useRef(0);
  const loadMoreSequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const searchSequenceRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const pendingDraftTabRef = useRef<CardDetailRequest["initialTab"]>("review");
  const sidebarActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const lastThumbnailErrorRefreshAtRef = useRef(0);
  const topicRefreshTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const topicRefreshAttemptsRef = useRef(new Map<string, number>());
  const previousActiveRef = useRef(false);
  const observedRevisionRef = useRef(refreshRevision);
  const observedLibraryViewRef = useRef<LibraryView>(libraryView);
  const observedSortModeRef = useRef(sortMode);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);
  useEffect(() => {
    sidebarProfileRef.current = sidebarProfile;
  }, [sidebarProfile]);
  function commitDraft(next: CardDraft): Promise<void> {
    draftRevisionRef.current += 1;
    draftRef.current = next;
    setDraft(next);
    return saveCardDraft(next);
  }

  function updateCommittedDraft(update: (current: CardDraft) => CardDraft): Promise<void> {
    return commitDraft(update(draftRef.current));
  }
  useEffect(() => {
    if (!incomingCardDraft || handledIncomingDraftIdRef.current === incomingCardDraft.id) return;
    handledIncomingDraftIdRef.current = incomingCardDraft.id;
    const next = incomingCardDraft.draft;
    const open = async () => {
      await commitDraft(next);
      setComposerVisible(true);
      onIncomingCardDraftHandled?.(incomingCardDraft.id);
    };
    const hasCurrentDraft = Boolean(draft.title.trim() || draft.text.trim() || draft.rewrittenText.trim() || draft.translationText.trim() || draft.replyText.trim() || draft.images.length);
    if (!hasCurrentDraft) {
      void open();
      return;
    }
    Alert.alert(t("quick_note.replace_draft_title"), t("quick_note.replace_draft_message"), [
      { text: t("common.cancel"), style: "cancel", onPress: () => onIncomingCardDraftHandled?.(incomingCardDraft.id) },
      { text: t("common.continue"), style: "destructive", onPress: () => void open() },
    ]);
  }, [incomingCardDraft?.id]);
  useEffect(() => {
    if (!sidebarVisible) return;
    let active = true;
    void Promise.all([
      getUserProfile().catch(() => null),
      getCurrentEntitlement().catch(() => null),
    ]).then(async ([profile, entitlement]) => {
      if (!active) return;
      if (profile) {
        const stableProfile = await stabilizeProfileAvatar(sidebarProfileRef.current, profile);
        if (!active) return;
        setSidebarProfile(stableProfile);
      }
      if (entitlement) setSidebarEntitlement(entitlement);
    });
    return () => { active = false; };
  }, [sidebarVisible]);
  useEffect(() => {
    let active = true;
    void getCardCapabilities()
      .then((value) => { if (active) setCardCapabilities(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    loadMoreSequenceRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoading(true);
    try {
      const collectionId = libraryView === "all" || libraryView === UNCLASSIFIED_VIEW ? undefined : libraryView;
      const [rows, collectionResult] = await Promise.all([
        getCardRecordPage({
          collectionId,
          unclassified: libraryView === UNCLASSIFIED_VIEW,
          limit: LIBRARY_PAGE_SIZE,
          sort: sortMode,
        }),
        getCardCollections(),
      ]);
      if (sequence !== refreshSequenceRef.current) return;
      const incomingRecords = rows.items.map((record) => isCardRecordGenerationInProgress(record.id) ? { ...record, status: "processing" as const } : record);
      const stableRecords = await stabilizeRecordThumbnails(recordsRef.current, incomingRecords);
      if (sequence !== refreshSequenceRef.current) return;
      setRecords(stableRecords);
      setCollections(collectionResult.collections);
      setNextCursor(rows.nextCursor);
      hasLoadedRef.current = true;
      lastRefreshAtRef.current = Date.now();
      if (libraryView !== "all" && libraryView !== UNCLASSIFIED_VIEW && !collectionResult.collections.some((collection) => collection.id === libraryView)) {
        setLibraryView("all");
      }
    } catch {
      if (sequence !== refreshSequenceRef.current) return;
      Alert.alert("暂时无法加载", "请检查网络后重试");
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false);
    }
  }, [libraryView, sortMode]);

  const refreshGeneratedTopic = useCallback((recordId: string) => {
    if (topicRefreshTimersRef.current.has(recordId)) return;
    const attempt = topicRefreshAttemptsRef.current.get(recordId) ?? 0;
    if (attempt >= TOPIC_REFRESH_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      topicRefreshTimersRef.current.delete(recordId);
      topicRefreshAttemptsRef.current.set(recordId, attempt + 1);
      void getCardRecord(recordId)
        .then((updated) => {
          if (updated.topic || updated.title) {
            topicRefreshAttemptsRef.current.delete(recordId);
            setRecords((current) => current.map((record) => record.id === recordId
              ? { ...record, title: updated.title, topic: updated.topic, displayTitle: updated.displayTitle }
              : record));
            return;
          }
          refreshGeneratedTopic(recordId);
        })
        .catch(() => refreshGeneratedTopic(recordId));
    }, TOPIC_REFRESH_DELAYS_MS[attempt]);
    topicRefreshTimersRef.current.set(recordId, timer);
  }, []);

  useEffect(() => () => {
    topicRefreshTimersRef.current.forEach((timer) => clearTimeout(timer));
    topicRefreshTimersRef.current.clear();
    topicRefreshAttemptsRef.current.clear();
  }, []);

  useEffect(() => subscribeCardGenerationState((recordId, state) => {
    if (state?.pendingTargets.length) {
      setRecords((current) => current.map((record) => record.id === recordId ? { ...record, status: "processing" } : record));
      return;
    }
    void refresh();
  }), [refresh]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMoreRef.current || !nextCursor || searchResults) return;
    const loadSequence = ++loadMoreSequenceRef.current;
    const refreshSequence = refreshSequenceRef.current;
    const requestedView = libraryView;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const collectionId = libraryView === "all" || libraryView === UNCLASSIFIED_VIEW ? undefined : libraryView;
      const page = await getCardRecordPage({
        collectionId,
        unclassified: libraryView === UNCLASSIFIED_VIEW,
        limit: LIBRARY_PAGE_SIZE,
        cursor: nextCursor,
        sort: sortMode,
      });
      if (
        loadSequence !== loadMoreSequenceRef.current
        || refreshSequence !== refreshSequenceRef.current
        || requestedView !== libraryView
      ) return;
      setRecords((current) => [...current, ...page.items.filter((row) => !current.some((item) => item.id === row.id))]);
      setNextCursor(page.nextCursor);
    } catch {
      // Keep the current archive visible; the next scroll can retry.
    } finally {
      if (loadSequence === loadMoreSequenceRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [libraryView, loading, nextCursor, searchResults, sortMode]);

  useEffect(() => {
    let cancelled = false;
    const revisionAtLoad = draftRevisionRef.current;
    void loadCardDraft().then(async (saved) => {
      if (cancelled) return;
      await bootstrapCard().catch(() => []);
      const restored = saved;
      if (cancelled || draftRevisionRef.current !== revisionAtLoad) return;
      await commitDraft(restored);
      restored.images
        .filter((image) => image.status !== "ready" && image.status !== "failed")
        .forEach((image) => void processDraftImage(image));
      if (restored.submitted && restored.recordId) {
        setActiveRecordId(restored.recordId);
        pollStartedAtRef.current = Date.now();
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const becameActive = isActive && !previousActiveRef.current;
    previousActiveRef.current = isActive;
    if (!isActive) return;
    const revisionChanged = observedRevisionRef.current !== refreshRevision;
    const libraryChanged = observedLibraryViewRef.current !== libraryView;
    const sortChanged = observedSortModeRef.current !== sortMode;
    observedRevisionRef.current = refreshRevision;
    observedLibraryViewRef.current = libraryView;
    observedSortModeRef.current = sortMode;
    const stale = Date.now() - lastRefreshAtRef.current >= BACKGROUND_REFRESH_INTERVAL_MS;
    if (!hasLoadedRef.current || revisionChanged || libraryChanged || sortChanged || (becameActive && stale)) void refresh();
  }, [isActive, libraryView, refresh, refreshRevision, sortMode]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !isActive || !hasLoadedRef.current) return;
      if (Date.now() - lastRefreshAtRef.current >= BACKGROUND_REFRESH_INTERVAL_MS) void refresh();
    });
    return () => subscription.remove();
  }, [isActive, refresh]);

  useEffect(() => {
    if (!isActive) return;
    const expiryTimes = records
      .map((record) => record.thumbnail?.urlExpiresAt ? Date.parse(record.thumbnail.urlExpiresAt) : Number.NaN)
      .filter(Number.isFinite);
    if (!expiryTimes.length) return;
    const nextRefreshIn = Math.max(1_000, Math.min(...expiryTimes) - Date.now() - THUMBNAIL_REFRESH_LEAD_MS);
    const timer = setTimeout(() => void refresh(), nextRefreshIn);
    return () => clearTimeout(timer);
  }, [isActive, records, refresh]);

  const recoverFailedThumbnail = useCallback(() => {
    const now = Date.now();
    if (now - lastThumbnailErrorRefreshAtRef.current < THUMBNAIL_ERROR_REFRESH_COOLDOWN_MS) return;
    lastThumbnailErrorRefreshAtRef.current = now;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (isActive) return;
    setSidebarVisible(false);
    setCollectionMoveVisible(false);
    setCollectionMoveTargetId(null);
    if (sidebarActionTimerRef.current) {
      clearTimeout(sidebarActionTimerRef.current);
      sidebarActionTimerRef.current = null;
    }
  }, [isActive]);

  useEffect(() => () => {
    if (sidebarActionTimerRef.current) clearTimeout(sidebarActionTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isActive || !activeRecordId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled || AppState.currentState !== "active") return;
      try {
        const task = await getCardTaskStatus(activeRecordId);
        if (cancelled) return;
        if (task.status === "completed") {
          const completedRecordId = activeRecordId;
          refreshGeneratedTopic(completedRecordId);
          try {
            await saveDraftClozeRanges(completedRecordId, draft.clozeRanges);
          } catch (error) {
            console.warn("[card] save draft cloze failed", error);
            Alert.alert(t("card_detail.card_saved"), t("card_detail.cloze_not_saved"));
          }
          if (composerVisible) {
            setComposerVisible(false);
            onOpenCard(completedRecordId, pendingDraftTabRef.current);
            pendingDraftTabRef.current = "review";
          }
          draft.images.forEach((image) => removePersistentDraftImage(image.localUri));
          setActiveRecordId(null);
          await commitDraft(EMPTY_DRAFT);
          await refresh();
          return;
        }
        if (task.status === "failed") {
          const restored = {
            ...draft,
            clientId: null,
            submitted: false,
            recordId: null,
            images: draft.images.map((image) => ({ ...image, uploadId: null, status: "pending" as const })),
          };
          setActiveRecordId(null);
          await commitDraft(restored);
          restored.images.forEach((image) => void processDraftImage(image));
          await refresh();
      Alert.alert(t("card_detail.error.save"), t("card_detail.error.try_again"));
          return;
        }
      } catch (error) {
        if (error instanceof CardApiError && error.status === 404) {
          const restored = {
            ...draft,
            clientId: null,
            submitted: false,
            recordId: null,
            images: draft.images.map((image) => ({ ...image, uploadId: null, status: "pending" as const })),
          };
          setActiveRecordId(null);
          await commitDraft(restored);
          restored.images.forEach((image) => void processDraftImage(image));
          return;
        }
      }
      const elapsed = Date.now() - pollStartedAtRef.current;
      timer = setTimeout(poll, elapsed < 30_000 ? 2_000 : 5_000);
    };

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void poll();
      else if (timer) clearTimeout(timer);
    });
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [activeRecordId, composerVisible, draft, isActive, onOpenCard, refresh, refreshGeneratedTopic]);

  async function updateDraftText(text: string): Promise<void> {
    const current = draftRef.current;
    if (text === current.text) return;
    const next: CardDraft = {
      ...current,
      text,
      // Generated layers and cloze offsets are valid only for the exact source
      // text they were created from. Keep the selections so save regenerates them.
      rewrittenText: "",
      translationText: "",
      replyText: "",
      derivedFromText: "",
      clozeRanges: [],
      clientId: current.recordId ? current.clientId : null,
      submitted: false,
    };
    await commitDraft(next);
  }

  async function updateDraftField(field: "title" | "rewrittenText" | "translationText" | "replyText", value: string): Promise<void> {
    const current = draftRef.current;
    const next = {
      ...current,
      [field]: value,
      ...(field === "rewrittenText" ? { clozeRanges: [] } : {}),
      ...(field !== "title" ? { derivedFromText: current.text } : {}),
      clientId: current.recordId ? current.clientId : null,
      submitted: false,
    };
    await commitDraft(next);
  }

  async function updateDraftEnabledLayers(enabledLayers: CardDraft["enabledLayers"]): Promise<void> {
    const current = draftRef.current;
    const next = {
      ...current,
      enabledLayers,
      ...(!enabledLayers.expression ? { rewrittenText: "" } : {}),
      ...(!enabledLayers.translation ? { translationText: "" } : {}),
      ...(!enabledLayers.reply ? { replyText: "" } : {}),
      clientId: current.recordId ? current.clientId : null,
      submitted: false,
    };
    await commitDraft(next);
  }

  async function updateDraftCollection(collectionId: string | null): Promise<void> {
    const current = draftRef.current;
    const next = { ...current, collectionId, clientId: current.recordId ? current.clientId : null, submitted: false };
    await commitDraft(next);
  }

  function openCardComposer(): void {
    const hasDraftContent = Boolean(draft.title.trim() || draft.text.trim() || draft.rewrittenText.trim() || draft.translationText.trim() || draft.replyText.trim() || draft.images.length);
    if (!hasDraftContent) {
      void commitDraft({ ...draftRef.current, collectionId: null });
    }
    setComposerVisible(true);
  }

  async function saveDraftClozeRanges(recordId: string, ranges: CardDraft["clozeRanges"]): Promise<void> {
    if (!ranges.length) return;
    const detail = await getCardRecord(recordId);
    let version = detail.practice?.clozeVersion ?? 0;
    for (const range of ranges) {
      const segment = detail.rewriteSegments.find((item) => range.startUtf16 >= item.startUtf16 && range.endUtf16 <= item.endUtf16);
      if (!segment) continue;
      const practice = await saveCardClozeUpdate(recordId, {
        baseVersion: version,
        operation: {
          type: "add",
          segmentId: segment.id,
          startUtf16: range.startUtf16 - segment.startUtf16,
          endUtf16: range.endUtf16 - segment.startUtf16,
        },
      });
      version = practice.clozeVersion;
    }
  }

  async function submit(initialTab: CardDetailRequest["initialTab"] = "review"): Promise<void> {
    if (submitInFlightRef.current) return;
    if (isCardGenerationInProgress()) {
      Alert.alert("请稍后再试", "有卡片正在处理，请等待完成后再操作。");
      return;
    }
    const snapshot = draftRef.current;
    const text = snapshot.text.trim();
    const count = countGraphemes(text);
    if (count < 1 || count > cardLimits.contentChars) {
      Alert.alert(t("card_detail.error.cannot_save"), t("card_detail.error.length_message"));
      return;
    }
    const clientId = snapshot.clientId ?? Crypto.randomUUID();
    const unavailableImage = snapshot.images.find((image) => image.status !== "ready");
    if (unavailableImage) {
      Alert.alert(
        unavailableImage.status === "failed" ? t("card_detail.photo.processing_failed") : t("card_detail.photo.not_ready"),
        unavailableImage.status === "failed"
          ? t("card_detail.photo.processing_failed_message")
          : t("card_detail.photo.not_ready_message"),
      );
      return;
    }
    const submitting = { ...snapshot, clientId, submitted: false };
    pendingDraftTabRef.current = initialTab;
    submitInFlightRef.current = true;
    setSending(true);
    let persistedRecordId = snapshot.recordId;
    let optimisticStarted = false;
    const selectedTargets: CardGenerationTarget[] = (["expression", "translation", "reply"] as const)
      .filter((target) => snapshot.enabledLayers[target]);
    try {
      await commitDraft(submitting);
      const derivedContentMatchesSource = snapshot.derivedFromText === snapshot.text;
      const existingContent = {
        expression: derivedContentMatchesSource && snapshot.enabledLayers.expression ? snapshot.rewrittenText.trim() : "",
        translation: derivedContentMatchesSource && snapshot.enabledLayers.translation ? snapshot.translationText.trim() : "",
        reply: derivedContentMatchesSource && snapshot.enabledLayers.reply ? snapshot.replyText.trim() : "",
      };
      let created = snapshot.recordId
        ? await getCardRecord(snapshot.recordId)
        : await createCardEntry({
            clientId,
            collectionId: snapshot.collectionId,
            title: snapshot.title.trim() || null,
            originalText: text || null,
            rewrittenText: existingContent.expression || null,
            translationText: existingContent.translation || null,
            replyText: existingContent.reply || null,
            generateRewrite: false,
            imageUploadIds: snapshot.images.map((image) => image.uploadId).filter((uploadId): uploadId is string => Boolean(uploadId)),
          });
      persistedRecordId = created.id;
      await commitDraft({ ...submitting, recordId: persistedRecordId });

      await setCardGenerationState(created.id, { pendingTargets: selectedTargets, failedTargets: [] });
      const firstDraftImage = snapshot.images[0];
      const optimisticRecord: CardRecordSummary = {
        ...created,
        status: "processing",
        ...(firstDraftImage && !created.thumbnail ? {
          thumbnail: { url: firstDraftImage.localUri, width: firstDraftImage.width, height: firstDraftImage.height },
        } : {}),
      };
      if (libraryView === "all" || (libraryView === UNCLASSIFIED_VIEW && created.collectionId === null) || created.collectionId === libraryView) {
        refreshSequenceRef.current += 1;
        setLoading(false);
        setRecords((current) => [optimisticRecord, ...current.filter((row) => row.id !== created.id)]);
      } else {
        setLibraryView("all");
      }
      optimisticStarted = true;
      setComposerVisible(false);
      setActiveRecordId(null);
      await commitDraft(EMPTY_DRAFT);
      setSending(false);
      onOpenCard(created.id, initialTab);

      let detail = await updateCardContent(created.id, {
        title: snapshot.title.trim() || null,
        originalText: text,
        collectionId: snapshot.collectionId,
        ...(!snapshot.enabledLayers.expression ? { rewrittenText: null } : {}),
        ...(!snapshot.enabledLayers.translation ? { translationText: null } : {}),
        ...(!snapshot.enabledLayers.reply ? { replyText: null } : {}),
      });
      const generation = await generateMissingCardContent(detail, selectedTargets);
      detail = generation.detail;
      created = detail;
      const createdForDisplay = firstDraftImage && !created.thumbnail
        ? {
            ...created,
            thumbnail: {
              url: firstDraftImage.localUri,
              width: firstDraftImage.width,
              height: firstDraftImage.height,
            },
          }
        : created;
      await setCardGenerationState(created.id, generation.failedTargets.length
        ? { pendingTargets: [], failedTargets: generation.failedTargets }
        : null);
      setRecords((current) => [{ ...createdForDisplay, status: "completed" }, ...current.filter((row) => row.id !== created.id)]);
      if (generation.failedTargets.length) {
        snapshot.images.forEach((image) => removePersistentDraftImage(image.localUri));
        await refresh();
        return;
      }
      if (!created.title && !created.topic) refreshGeneratedTopic(created.id);
      if (created.status === "completed") {
        try {
          await saveDraftClozeRanges(created.id, snapshot.clozeRanges);
        } catch (error) {
          console.warn("[card] save converted cloze failed", error);
          Alert.alert(t("card_detail.card_saved"), t("card_detail.cloze_not_saved"));
        }
        snapshot.images.forEach((image) => removePersistentDraftImage(image.localUri));
        await refresh();
        pendingDraftTabRef.current = "review";
        return;
      }
      setActiveRecordId(created.id);
      pollStartedAtRef.current = Date.now();
    } catch (error) {
      console.warn("[card] create entry failed", error);
      if (optimisticStarted && persistedRecordId) {
        await setCardGenerationState(persistedRecordId, { pendingTargets: [], failedTargets: selectedTargets });
        try {
          const saved = await getCardRecord(persistedRecordId);
          setRecords((current) => [{ ...saved, status: "completed" }, ...current.filter((row) => row.id !== persistedRecordId)]);
        } catch {
          await refresh();
        }
        snapshot.images.forEach((image) => removePersistentDraftImage(image.localUri));
        return;
      }
      const retryable = {
        ...submitting,
        recordId: persistedRecordId,
        clientId: error instanceof CardApiError && error.code === "CARD_CLIENT_ID_CONSUMED"
          ? null
          : submitting.clientId,
        submitted: false,
      };
      await commitDraft(retryable);
      if (error instanceof CardApiError && error.code === "TOKEN_QUOTA_EXCEEDED") {
        await showUsageQuotaExhausted("token");
        return;
      }
      if (isCardResourceLimitedError(error)) {
        Alert.alert("请稍后再试", "有卡片正在处理，请等待完成后再操作。");
        return;
      }
      Alert.alert(
        error instanceof CardApiError && error.code === "TASK_IN_PROGRESS" ? t("card_detail.processing") : t("card_detail.error.send"),
        error instanceof CardApiError && error.code === "TASK_IN_PROGRESS"
          ? t("card_detail.processing_existing")
          : t("card_detail.draft_retained"),
      );
    } finally {
      submitInFlightRef.current = false;
      setSending(false);
    }
  }

  function persistDraftImage(image: CardDraftImage): void {
    void updateCommittedDraft((current) => {
      const images = current.images.some((candidate) => candidate.localUri === image.localUri)
        ? current.images.map((candidate) => candidate.localUri === image.localUri ? image : candidate)
        : current.images.length < cardLimits.imagesPerCard ? [...current.images, image] : current.images;
      return { ...current, images, clientId: current.recordId ? current.clientId : null, submitted: false };
    });
  }

  async function processDraftImage(image: CardDraftImage): Promise<void> {
    try {
      const ready = await uploadCardDraftImage(image, persistDraftImage);
      persistDraftImage(ready);
    } catch (error) {
      console.warn("[card] image upload failed", error);
      if (error instanceof CardApiError && (error.code === "IMAGE_STORAGE_QUOTA_EXCEEDED" || error.code === "CARD_IMAGE_QUOTA_EXCEEDED")) {
        void showUsageQuotaExhausted("image");
      } else {
        Alert.alert(t("card_detail.photo.add_failed_title"), t("card_detail.photo.add_failed_message"));
      }
      void updateCommittedDraft((current) => {
        const next = {
          ...current,
          images: current.images.map((candidate) => candidate.localUri === image.localUri
            ? { ...candidate, status: "failed" as const }
            : candidate),
        };
        return next;
      });
    }
  }

  async function showUsageQuotaExhausted(kind: "token" | "image"): Promise<void> {
    const [entitlement, usage] = await Promise.all([
      getCurrentEntitlement().catch(() => null),
      getUsageV2().catch(() => null),
    ]);
    const isMember = (entitlement?.isMember ?? entitlement?.isPro) === true;
    if (!isMember) {
      Alert.alert(t(kind === "token" ? "chat.error.quota_free_empty" : "image.error.quota_free_empty"));
      return;
    }
    const refreshAt = kind === "token" ? usage?.token.periodEnd : usage?.images.periodEnd;
    Alert.alert(tf(
      kind === "token" ? "chat.error.quota_member_empty" : "image.error.quota_member_empty",
      { time: formatQuotaRefreshTime(refreshAt ?? null) },
    ));
  }

  async function pickImage(source: "camera" | "library"): Promise<void> {
    const remaining = cardLimits.imagesPerCard - draft.images.length;
    if (remaining <= 0) {
      Alert.alert(t("card_detail.photo.limit_title"));
      return;
    }
    if (source === "camera" || Platform.OS !== "android") {
      const permission = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("card_detail.photo.permission_title"), source === "camera" ? t("card_detail.photo.camera_permission_message") : t("card_detail.photo.library_permission_message"));
        return;
      }
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: true, selectionLimit: remaining });
    const selected = result.assets?.filter((asset) => asset.uri && asset.width && asset.height) ?? [];
    if (result.canceled || !selected.length) return;
    if (selected.length > remaining) Alert.alert(t("card_detail.photo.limit_title"), tf("card_detail.photo.selection_limited", { count: remaining }));
    for (const asset of selected.slice(0, remaining)) await applyDraftImage(asset);
  }

  async function applyDraftImage(selected: { uri: string; width: number; height: number }): Promise<void> {
    if (draft.images.length >= cardLimits.imagesPerCard) {
      Alert.alert(t("card_detail.photo.limit_title"));
      return;
    }
    setPreparingDraftImageCount((count) => count + 1);
    try {
      const prepared = await prepareCardDraftImage({ uri: selected.uri, width: selected.width, height: selected.height });
      persistDraftImage(prepared);
      void processDraftImage(prepared);
    } catch {
      Alert.alert(t("card_detail.photo.prepare_failed_title"), t("card_detail.photo.prepare_failed_message"));
    } finally {
      setPreparingDraftImageCount((count) => Math.max(0, count - 1));
    }
  }

  function removeDraftImage(localUri?: string): void {
    const image = localUri ? draft.images.find((candidate) => candidate.localUri === localUri) : draft.images[draft.images.length - 1];
    if (!image) return;
    void updateCommittedDraft((current) => {
      return {
        ...current,
        images: current.images.filter((candidate) => candidate.localUri !== image.localUri),
        clientId: current.recordId ? current.clientId : null,
        submitted: false,
      };
    });
    removePersistentDraftImage(image.localUri);
    if (image.uploadId) void deleteCardImageUpload(image.uploadId).catch(() => undefined);
  }

  function openDetail(record: CardRecordSummary, origin?: CardDetailRequest["origin"]): void {
    if (record.status !== "completed") {
      Alert.alert("仍在整理", "OIO 正在整理这条记录");
      return;
    }
    onOpenCard(record.id, "review", origin);
  }

  async function submitSearch(): Promise<void> {
    const query = searchQuery.trim();
    if (!query) {
      clearSearch();
      return;
    }
    const sequence = ++searchSequenceRef.current;
    setSearching(true);
    try {
      const collectionId = searchCollectionId === null ? "unclassified" : searchCollectionId;
      const rows = await searchCardsLexically({ q: query, collectionId, limit: 50 });
      if (sequence === searchSequenceRef.current) setSearchResults(rows);
    } catch {
      if (sequence === searchSequenceRef.current) {
        Alert.alert("搜索失败", "请检查网络后重试");
      }
    } finally {
      if (sequence === searchSequenceRef.current) setSearching(false);
    }
  }

  function clearSearch(): void {
    searchSequenceRef.current += 1;
    setSearchQuery("");
    setSearchResults(null);
    setSearching(false);
  }

  function closeSearch(): void {
    setSearchVisible(false);
    Keyboard.dismiss();
  }

  function selectLibraryView(view: LibraryView): void {
    clearSearch();
    setLibraryView(view);
  }

  function confirmDelete(recordId: string): void {
    Alert.alert("删除这条记录？", "删除后无法恢复", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => void deleteCardRecord(recordId).then(() => {
          setRecords((rows) => rows.filter((row) => row.id !== recordId));
        }).catch(() => Alert.alert("删除失败", "请稍后重试")),
      },
    ]);
  }

  function openRecordActions(record: CardRecordSummary, anchor: RecordActionAnchor): void {
    setRecordActionMenu({ record, anchor });
  }

  function openMoveActions(record: CardRecordSummary): void {
    setRecordMoveTarget(record);
  }

  async function moveRecord(record: CardRecordSummary, collectionId: string | null): Promise<void> {
    await moveCardToCollection(record.id, collectionId);
    setRecords((current) => {
      if (libraryView === UNCLASSIFIED_VIEW ? collectionId !== null : libraryView !== "all" && libraryView !== collectionId) {
        return current.filter((candidate) => candidate.id !== record.id);
      }
      return current.map((candidate) => candidate.id === record.id ? { ...candidate, collectionId } : candidate);
    });
    setCollections((current) => current.map((collection) => {
      if (collection.id === record.collectionId) return { ...collection, cardCount: Math.max(0, collection.cardCount - 1) };
      if (collection.id === collectionId) return { ...collection, cardCount: collection.cardCount + 1 };
      return collection;
    }));
  }

  async function saveCollection(name: string, collectionId?: string, parentId: string | null = null): Promise<void> {
    if (collectionId) await renameCardCollection(collectionId, name);
    else await createCardCollection(name, parentId);
    await refresh();
  }

  async function removeCollection(collection: CardCollection): Promise<void> {
    const removedIds = collectionDescendantIds(collection.id, collections);
    removedIds.add(collection.id);
    await deleteCardCollection(collection.id);
    if (removedIds.has(libraryView)) {
      clearSearch();
      setLibraryView("all");
      return;
    }
    await refresh();
  }

  function closeSidebarThen(action: () => void): void {
    if (sidebarActionTimerRef.current) clearTimeout(sidebarActionTimerRef.current);
    setSidebarVisible(false);
    sidebarActionTimerRef.current = setTimeout(() => {
      sidebarActionTimerRef.current = null;
      action();
    }, 220);
  }

  async function moveCollection(collectionId: string, parentId: string | null, position?: number): Promise<void> {
    await moveCardCollection(collectionId, parentId, position);
    await refresh();
  }

  async function reorderFavoriteCollection(collectionId: string, position: number): Promise<void> {
    await reorderFavoriteCardCollection(collectionId, position);
    await refresh();
  }

  async function toggleCollectionFavorite(collection: CardCollection): Promise<void> {
    await setCardCollectionFavorite(collection.id, !collection.isFavorite);
    await refresh();
  }

  const activeCollection = collections.find((collection) => collection.id === libraryView);
  const headerTitle = libraryView === "all"
        ? t("sidebar.collections")
        : libraryView === UNCLASSIFIED_VIEW
          ? t("sidebar.unclassified")
        : activeCollection?.name ?? t("sidebar.collections");

  function chooseLibraryAction(): void {
    setLibraryMenuPage("main");
    setLibraryMenuVisible(true);
  }

  function enterRecordSelection(): void {
    setLibraryMenuVisible(false);
    setSelectingRecords(true);
    setSelectedRecordIds(new Set());
  }

  function selectLibrarySort(mode: "newest" | "oldest"): void {
    setSortMode(mode);
    setLibraryMenuVisible(false);
  }

  function leaveRecordSelection(): void {
    setSelectingRecords(false);
    setSelectedRecordIds(new Set());
  }

  function toggleRecordSelection(recordId: string): void {
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  function confirmBatchDelete(): void {
    if (!selectedRecordIds.size) return;
    Alert.alert(tf("library.delete_selected_title", { count: selectedRecordIds.size }), t("library.delete_selected_message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => void (async () => {
        const ids = [...selectedRecordIds];
        try {
          await Promise.all(ids.map((id) => deleteCardRecord(id)));
          setRecords((current) => current.filter((record) => !selectedRecordIds.has(record.id)));
          leaveRecordSelection();
        } catch {
          Alert.alert(t("library.delete_failed"), t("card_detail.error.try_again"));
          await refresh();
        }
      })() },
    ]);
  }

  async function moveSelectedRecords(collectionId: string | null): Promise<void> {
    const ids = [...selectedRecordIds];
    if (!ids.length) return;
    await moveCardsToCollection(ids, collectionId);
    setBatchMoveVisible(false);
    leaveRecordSelection();
    await refresh();
  }

  const openAssistant = () => {
    const available = sidebarEntitlement?.tier === "plus" || sidebarEntitlement?.tier === "pro";
    if (available) onOpenAssistant();
    else Alert.alert(t("sidebar.assistant_members_only_title"), t("sidebar.assistant_members_only_message"));
  };
  const edgeSidebarResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Boolean(
      !sidebarVisible
      && !searchVisible
      && !composerVisible
      && !selectingRecords
      && gesture.x0 <= 28
      && gesture.dx > 14
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4
    ),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx > 64 || gesture.vx > 0.55) {
        Keyboard.dismiss();
        setSidebarVisible(true);
      }
    },
  }), [composerVisible, searchVisible, selectingRecords, sidebarVisible]);

  return (
    <SafeAreaView style={styles.container} {...edgeSidebarResponder.panHandlers}>
      <View style={styles.brandRow}>
        <Pressable accessibilityLabel={selectingRecords ? t("common.cancel") : t("quick_note.a11y.open_nav")} style={styles.headerIconButton} onPress={() => {
          if (selectingRecords) {
            leaveRecordSelection();
            return;
          }
          Keyboard.dismiss();
          setSidebarVisible(true);
        }}>
          <Ionicons name={selectingRecords ? "close" : "menu-outline"} size={27} color={theme.colors.text} />
        </Pressable>
        {selectingRecords
          ? <Text style={styles.selectionHeaderTitle}>{selectedRecordIds.size}</Text>
          : <Pressable style={styles.homeSectionTabs} onPress={chooseLibraryAction}><Text numberOfLines={1} style={styles.homeHeaderTitle}>{headerTitle}</Text><Ionicons name="chevron-down" size={15} color={theme.colors.textSecondary} /></Pressable>}
        <View style={styles.headerActions}>
          {selectingRecords ? <View style={styles.headerIconButton} /> : <><Pressable accessibilityLabel={t("contact.curious_companion.name")} style={styles.headerIconButton} onPress={openAssistant}>
            <OioCharacter width={27} height={25} />
          </Pressable><Pressable
            accessibilityLabel={t("quick_note.a11y.search")}
            style={styles.headerIconButton}
            onPress={() => {
              setSearchCollectionId(undefined);
              setSearchVisible(true);
            }}
          >
            <Ionicons name="search-outline" size={23} color={theme.colors.text} />
          </Pressable></>}
        </View>
      </View>

      <FlatList
        style={styles.libraryList}
        data={records}
        keyExtractor={(record) => record.id}
        renderItem={({ item: record }) => (
          <CardCard record={record} collectionName={record.collectionId ? collections.find((collection) => collection.id === record.collectionId)?.name : undefined} selecting={selectingRecords} selected={selectedRecordIds.has(record.id)} onPress={(origin) => selectingRecords ? toggleRecordSelection(record.id) : void openDetail(record, origin)} onOpenActions={(anchor) => openRecordActions(record, anchor)} onThumbnailError={recoverFailedThumbnail} />
        )}
        contentContainerStyle={styles.list}
        alwaysBounceVertical={false}
        bounces={false}
        showsVerticalScrollIndicator
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={40}
        windowSize={7}
        onEndReachedThreshold={0.45}
        onEndReached={() => void loadMore()}
        ListEmptyComponent={loading ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loader} /> : (
          <View style={styles.emptyCard}>
            {libraryView === "all" ? <>
              <Text style={styles.emptyTitle}>{t("quick_note.empty_cards")}</Text>
              <Text style={styles.emptyText}>{t("quick_note.empty_cards_hint")}</Text>
            </> : null}
            <Pressable style={styles.emptyAction} onPress={openCardComposer}>
              <Text style={styles.emptyActionText}>{t("quick_note.first_card")}</Text>
            </Pressable>
          </View>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loadMoreIndicator} /> : null}
        ListHeaderComponent={<View style={styles.recallShortcuts}><Pressable style={styles.recallShortcut} onPress={() => onOpenRecall("today")}><Text style={styles.recallShortcutTitle}>{t("recall.today_shortcut")}</Text></Pressable><Pressable style={styles.recallShortcut} onPress={() => onOpenRecall("yesterday")}><Text style={styles.recallShortcutTitle}>{t("recall.yesterday_shortcut")}</Text></Pressable><Pressable style={styles.recallShortcut} onPress={() => onOpenRecall("blind")}><Text style={styles.recallShortcutTitle}>{t("recall.blind_box")}</Text></Pressable></View>}
      />
      {recordActionMenu ? <View style={styles.recordActionLayer}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setRecordActionMenu(null)} />
        <View style={[
          styles.recordActionMenu,
          {
            top: (() => {
              const menuHeight = recordActionMenu.record.source === "card" ? 85 : 43;
              const below = recordActionMenu.anchor.y + recordActionMenu.anchor.height + 7;
              const availableBottom = windowSize.height - screenInsets.bottom - 8;
              return below + menuHeight <= availableBottom
                ? below
                : Math.max(screenInsets.top + 8, recordActionMenu.anchor.y - menuHeight - 7);
            })(),
            left: Math.min(windowSize.width - 140, Math.max(12, recordActionMenu.anchor.x + recordActionMenu.anchor.width - 128)),
          },
        ]}>
          {recordActionMenu.record.source === "card" ? <>
            <Pressable style={styles.recordActionItem} onPress={() => {
              const record = recordActionMenu.record;
              setRecordActionMenu(null);
              openMoveActions(record);
            }}>
              <Ionicons name="folder-outline" size={16} color={theme.colors.textSecondary} />
              <Text style={styles.recordActionText}>{t("library.move_to")}</Text>
            </Pressable>
            <View style={styles.recordActionDivider} />
          </> : null}
          <Pressable style={styles.recordActionItem} onPress={() => {
            const recordId = recordActionMenu.record.id;
            setRecordActionMenu(null);
            confirmDelete(recordId);
          }}>
            <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
            <Text style={[styles.recordActionText, styles.recordActionDanger]}>{t("common.delete")}</Text>
          </Pressable>
        </View>
      </View> : null}
      {!selectingRecords ? <Pressable
        accessibilityLabel={t("quick_note.a11y.make_card")}
        style={styles.floatingRecordButton}
        onPress={openCardComposer}
      >
        <Ionicons name="create-outline" size={23} color="#171717" />
      </Pressable> : null}
      {selectingRecords && selectedRecordIds.size ? <View style={[styles.batchActionBar, { paddingBottom: Math.max(screenInsets.bottom, 10) }]}><Pressable style={styles.batchAction} onPress={() => setBatchMoveVisible(true)}><Ionicons name="folder-open-outline" size={22} color={theme.colors.text} /><Text style={styles.batchActionText}>{t("library.move")}</Text></Pressable><Pressable style={styles.batchAction} onPress={confirmBatchDelete}><Ionicons name="trash-outline" size={22} color={theme.colors.danger} /><Text style={[styles.batchActionText, { color: theme.colors.danger }]}>{t("common.delete")}</Text></Pressable></View> : null}
      <Modal visible={libraryMenuVisible} transparent animationType="fade" onRequestClose={() => setLibraryMenuVisible(false)}>
        <Pressable style={styles.libraryMenuBackdrop} onPress={() => setLibraryMenuVisible(false)}>
          <Pressable style={[styles.libraryMenuPanel, { top: screenInsets.top + 55 }]} onPress={() => undefined}>
            {libraryMenuPage === "main" ? <>
              <Pressable style={styles.libraryMenuRow} onPress={enterRecordSelection}>
                <View style={styles.libraryMenuLeadingIcon}><Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.text} /></View>
                <View style={styles.libraryMenuTextBlock}><Text style={styles.libraryMenuTitle}>{t("library.multi_select")}</Text></View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </Pressable>
              <View style={styles.libraryMenuDivider} />
              <Pressable style={styles.libraryMenuRow} onPress={() => setLibraryMenuPage("sort")}>
                <View style={styles.libraryMenuLeadingIcon}><Ionicons name="swap-vertical" size={24} color={theme.colors.text} /></View>
                <View style={styles.libraryMenuTextBlock}>
                  <Text style={styles.libraryMenuTitle}>{t("library.sort_title")}</Text>
                  <Text style={styles.libraryMenuSubtitle}>{sortMode === "newest" ? t("library.sort_newest") : t("library.sort_oldest")}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </Pressable>
            </> : <>
              <Pressable style={styles.libraryMenuRow} onPress={() => setLibraryMenuPage("main")}>
                <View style={styles.libraryMenuLeadingIcon}><Ionicons name="chevron-back" size={22} color={theme.colors.text} /></View>
                <View style={styles.libraryMenuTextBlock}><Text style={styles.libraryMenuTitle}>{t("library.sort_title")}</Text></View>
                <View style={styles.libraryMenuTrailingIcon} />
              </Pressable>
              <View style={styles.libraryMenuDivider} />
              <Pressable style={styles.libraryMenuRow} onPress={() => selectLibrarySort("newest")}>
                <View style={styles.libraryMenuLeadingIcon}><Ionicons name="arrow-down-outline" size={22} color={theme.colors.text} /></View>
                <View style={styles.libraryMenuTextBlock}><Text style={styles.libraryMenuOptionText}>{t("library.sort_newest")}</Text></View>
                <View style={styles.libraryMenuTrailingIcon}>{sortMode === "newest" ? <Ionicons name="checkmark" size={21} color={theme.colors.text} /> : null}</View>
              </Pressable>
              <View style={styles.libraryMenuDivider} />
              <Pressable style={styles.libraryMenuRow} onPress={() => selectLibrarySort("oldest")}>
                <View style={styles.libraryMenuLeadingIcon}><Ionicons name="arrow-up-outline" size={22} color={theme.colors.text} /></View>
                <View style={styles.libraryMenuTextBlock}><Text style={styles.libraryMenuOptionText}>{t("library.sort_oldest")}</Text></View>
                <View style={styles.libraryMenuTrailingIcon}>{sortMode === "oldest" ? <Ionicons name="checkmark" size={21} color={theme.colors.text} /> : null}</View>
              </Pressable>
            </>}
          </Pressable>
        </Pressable>
      </Modal>
      <AnimatedSearchOverlay visible={searchVisible}>
        <CardSearchScreen
          query={searchQuery}
          results={searchResults}
          searching={searching}
          collections={collections}
          collectionId={searchCollectionId}
          onClose={closeSearch}
          onQueryChange={(value) => { setSearchQuery(value); if (searchResults !== null) setSearchResults(null); }}
          onSearch={() => void submitSearch()}
          onCollectionChange={(value) => { setSearchCollectionId(value); setSearchResults(null); }}
          onOpenResult={(recordId) => onOpenCard(recordId)}
        />
      </AnimatedSearchOverlay>

      {composerVisible ? (
        <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setComposerVisible(false)}>
          <CardDetailModal
            detail={null}
            loading={false}
            draft={{ value: draft, sending, imageAdding: preparingDraftImageCount > 0 }}
            draftLimits={cardLimits}
            draftCollections={collections}
            draftSafeArea={{ top: screenInsets.top, bottom: screenInsets.bottom }}
            onClose={() => setComposerVisible(false)}
            onDraftChange={(value) => void updateDraftText(value)}
            onDraftFieldChange={(field, value) => void updateDraftField(field, value)}
            onDraftEnabledLayersChange={(layers) => void updateDraftEnabledLayers(layers)}
            onDraftCollectionChange={(collectionId) => void updateDraftCollection(collectionId)}
            onDraftSave={(initialTab) => void submit(initialTab)}
            onDraftChooseImage={() => void pickImage("library")}
            onDraftTakePhoto={() => void pickImage("camera")}
            onDraftSelectImage={(asset) => void applyDraftImage(asset)}
            onDraftRemoveImage={removeDraftImage}
          />
        </Modal>
      ) : null}
      <CollectionMoveModal
        visible={collectionMoveVisible}
        collections={collections}
        collectionId={collectionMoveTargetId}
        onClose={() => {
          setCollectionMoveVisible(false);
          setCollectionMoveTargetId(null);
        }}
        onMove={moveCollection}
      />
      <CollectionPickerModal
        visible={Boolean(recordMoveTarget)}
        title={t("library.move_to")}
        collections={collections}
        value={recordMoveTarget?.collectionId ?? null}
        onClose={() => setRecordMoveTarget(null)}
        onSelect={async (collectionId) => { if (recordMoveTarget) await moveRecord(recordMoveTarget, collectionId ?? null); }}
      />
      <CollectionPickerModal
        visible={batchMoveVisible}
        title={t("library.move_to")}
        collections={collections}
        value={null}
        onClose={() => setBatchMoveVisible(false)}
        onSelect={async (collectionId) => moveSelectedRecords(collectionId ?? null)}
      />
      <LibrarySidebar
        visible={sidebarVisible}
        activeView={libraryView}
        collections={collections}
        profile={sidebarProfile}
        entitlement={sidebarEntitlement}
        onClose={() => setSidebarVisible(false)}
        onSelect={(view) => {
          selectLibraryView(view);
        }}
        onOpenRecall={() => {
          closeSidebarThen(onOpenRecall);
        }}
        onOpenAssistant={() => closeSidebarThen(onOpenAssistant)}
        onOpenCalendar={() => closeSidebarThen(() => setCalendarVisible(true))}
        onCreateCollection={(name, parentId) => saveCollection(name, undefined, parentId)}
        onRenameCollection={(collectionId, name) => saveCollection(name, collectionId)}
        onToggleFavorite={toggleCollectionFavorite}
        onDeleteCollection={removeCollection}
        onRequestMoveCollection={(collectionId) => {
          setCollectionMoveTargetId(collectionId);
          closeSidebarThen(() => setCollectionMoveVisible(true));
        }}
        onReorderCollection={(collectionId, parentId, position) => moveCollection(collectionId, parentId, position)}
        onReorderFavoriteCollection={reorderFavoriteCollection}
        onOpenAccount={() => {
          closeSidebarThen(onOpenAccount);
        }}
      />
      <CardCalendarScreen visible={calendarVisible} onClose={() => setCalendarVisible(false)} onOpenCard={(recordId) => onOpenCard(recordId)} />
    </SafeAreaView>
  );
}

function LibrarySidebar({ visible, activeView, collections, profile, entitlement, onClose, onSelect, onOpenRecall, onOpenAssistant, onOpenCalendar, onCreateCollection, onRenameCollection, onToggleFavorite, onDeleteCollection, onRequestMoveCollection, onReorderCollection, onReorderFavoriteCollection, onOpenAccount }: {
  visible: boolean;
  activeView: LibraryView;
  collections: CardCollection[];
  profile: UserProfile | null;
  entitlement: CurrentEntitlement | null;
  onClose: () => void;
  onSelect: (view: LibraryView) => void;
  onOpenRecall: () => void;
  onOpenAssistant: () => void;
  onOpenCalendar: () => void;
  onCreateCollection: (name: string, parentId: string | null) => Promise<void>;
  onRenameCollection: (collectionId: string, name: string) => Promise<void>;
  onToggleFavorite: (collection: CardCollection) => Promise<void>;
  onDeleteCollection: (collection: CardCollection) => Promise<void>;
  onRequestMoveCollection: (collectionId: string) => void;
  onReorderCollection: (collectionId: string, parentId: string | null, position: number) => Promise<void>;
  onReorderFavoriteCollection: (collectionId: string, position: number) => Promise<void>;
  onOpenAccount: () => void;
}) {
  const assistantAvailable = entitlement?.tier === "plus" || entitlement?.tier === "pro";
  const insets = useSafeAreaInsets();
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [savingCollection, setSavingCollection] = useState(false);
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set());
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [favoriteSavingId, setFavoriteSavingId] = useState<string | null>(null);
  const [reorderSavingId, setReorderSavingId] = useState<string | null>(null);
  const [orderedCollections, setOrderedCollections] = useState(collections);
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);
  const [collectionDragLocked, setCollectionDragLocked] = useState(false);
  const collectionDragUnlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collectionScrollRef = useRef<React.ElementRef<typeof NestableScrollContainer>>(null);
  const focusedCollectionInputHandleRef = useRef<object | null>(null);
  const favoriteCollections = orderedCollections
    .filter((collection) => collection.isFavorite)
    .sort((left, right) => (left.favoriteSortOrder ?? Number.MAX_SAFE_INTEGER) - (right.favoriteSortOrder ?? Number.MAX_SAFE_INTEGER));

  useEffect(() => {
    if (!draggingCollectionId && !reorderSavingId) setOrderedCollections(collections);
  }, [collections, draggingCollectionId, reorderSavingId]);

  useEffect(() => () => {
    if (collectionDragUnlockTimer.current) clearTimeout(collectionDragUnlockTimer.current);
  }, []);

  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      const nativeHandle = focusedCollectionInputHandleRef.current;
      if (nativeHandle) scrollCollectionInputIntoView(nativeHandle);
    });
    return () => subscription.remove();
  }, []);

  function beginNativeCollectionDrag(collectionId: string | undefined): void {
    if (!collectionId || collectionDragLocked) return;
    if (collectionDragUnlockTimer.current) clearTimeout(collectionDragUnlockTimer.current);
    collectionDragUnlockTimer.current = null;
    setCollectionDragLocked(true);
    setDraggingCollectionId(collectionId);
  }

  function unlockCollectionDragAfterSettle(): void {
    if (collectionDragUnlockTimer.current) clearTimeout(collectionDragUnlockTimer.current);
    collectionDragUnlockTimer.current = setTimeout(() => {
      collectionDragUnlockTimer.current = null;
      setCollectionDragLocked(false);
    }, COLLECTION_DRAG_SETTLE_GUARD_MS);
  }

  async function commitNativeReorder(parentId: string | null, data: CardCollection[], from: number, to: number): Promise<void> {
    setDraggingCollectionId(null);
    unlockCollectionDragAfterSettle();
    if (from === to) return;
    const moved = data[to];
    if (!moved || moved.parentId !== parentId) return;
    const reorderedIds = new Set(data.map((collection) => collection.id));
    let dataIndex = 0;
    const nextCollections = orderedCollections.map((collection) => collection.parentId === parentId && reorderedIds.has(collection.id) ? data[dataIndex++] : collection);
    const serverPosition = nextCollections.filter((collection) => collection.parentId === parentId).findIndex((collection) => collection.id === moved.id);
    if (serverPosition < 0) return;
    setOrderedCollections(nextCollections);
    setReorderSavingId(moved.id);
    try {
      await onReorderCollection(moved.id, parentId, serverPosition);
    } catch (error) {
      setOrderedCollections(collections);
      Alert.alert("无法调整顺序", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setReorderSavingId(null);
    }
  }

  async function commitFavoriteReorder(data: CardCollection[], from: number, to: number): Promise<void> {
    setDraggingCollectionId(null);
    unlockCollectionDragAfterSettle();
    if (from === to) return;
    const moved = data[to];
    if (!moved) return;
    const favoritePositions = new Map(data.map((collection, favoriteSortOrder) => [collection.id, favoriteSortOrder]));
    setOrderedCollections((current) => current.map((collection) => favoritePositions.has(collection.id)
      ? { ...collection, favoriteSortOrder: favoritePositions.get(collection.id)! }
      : collection));
    setReorderSavingId(moved.id);
    try {
      await onReorderFavoriteCollection(moved.id, to);
    } catch (error) {
      setOrderedCollections(collections);
      Alert.alert("无法调整收藏顺序", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setReorderSavingId(null);
    }
  }

  async function toggleFavorite(collection: CardCollection): Promise<void> {
    if (favoriteSavingId) return;
    setFavoriteSavingId(collection.id);
    try {
      await onToggleFavorite(collection);
    } catch (error) {
      Alert.alert("无法更新收藏", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setFavoriteSavingId(null);
    }
  }

  function confirmDeleteCollection(collection: CardCollection): void {
    Alert.alert("删除这个生活集？", "其子生活集也会删除，其中的生活记录会回到未分类，但记录本身不会删除。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => void onDeleteCollection(collection).catch(() => Alert.alert("删除失败", "请稍后重试")),
      },
    ]);
  }

  function runCollectionAction(collection: CardCollection, index: number): void {
    if (index === 0) beginCreating(collection.id);
    else if (index === 1) beginRenaming(collection);
    else if (index === 2) onRequestMoveCollection(collection.id);
    else if (index === 3) confirmDeleteCollection(collection);
  }

  function openCollectionActions(collection: CardCollection): void {
    const options = [
      "新建子生活集",
      "重命名",
      "移动到",
      "删除",
      "取消",
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 4, destructiveButtonIndex: 3, title: collection.name },
        (index) => {
          if (index < 4) runCollectionAction(collection, index);
        },
      );
      return;
    }
    Alert.alert(collection.name, undefined, [
      { text: options[0], onPress: () => runCollectionAction(collection, 0) },
      { text: options[1], onPress: () => runCollectionAction(collection, 1) },
      { text: options[2], onPress: () => runCollectionAction(collection, 2) },
      { text: options[3], style: "destructive", onPress: () => runCollectionAction(collection, 3) },
      { text: "取消", style: "cancel" },
    ]);
  }

  async function createCollection(): Promise<void> {
    const name = newCollectionName.trim();
    if (!name || savingCollection) return;
    setSavingCollection(true);
    try {
      await onCreateCollection(name, creatingParentId ?? null);
      if (creatingParentId) {
        setExpandedCollectionIds((current) => new Set(current).add(creatingParentId));
      }
      setNewCollectionName("");
      setCreatingParentId(undefined);
    } catch (error) {
      Alert.alert("无法新建生活集", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setSavingCollection(false);
    }
  }

  function beginCreating(parentId: string | null): void {
    setCreatingParentId(parentId);
    setNewCollectionName("");
    if (parentId) setExpandedCollectionIds((current) => new Set(current).add(parentId));
  }

  function beginRenaming(collection: CardCollection): void {
    setCreatingParentId(undefined);
    setNewCollectionName("");
    setRenamingCollectionId(collection.id);
    setRenameValue(collection.name);
  }

  function cancelRenaming(): void {
    setRenamingCollectionId(null);
    setRenameValue("");
  }

  async function submitRename(): Promise<void> {
    const name = renameValue.trim();
    if (!renamingCollectionId || !name || savingRename) return;
    setSavingRename(true);
    try {
      await onRenameCollection(renamingCollectionId, name);
      cancelRenaming();
    } catch (error) {
      Alert.alert("无法重命名生活集", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setSavingRename(false);
    }
  }

  function toggleExpanded(collectionId: string): void {
    setExpandedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }

  function scrollCollectionInputIntoView(nativeHandle: object): void {
    collectionScrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(nativeHandle, 18, true);
  }

  function keepCollectionInputVisible(nativeHandle: object): void {
    focusedCollectionInputHandleRef.current = nativeHandle;
    setTimeout(() => {
      if (focusedCollectionInputHandleRef.current === nativeHandle) {
        scrollCollectionInputIntoView(nativeHandle);
      }
    }, 180);
  }

  function clearFocusedCollectionInput(nativeHandle: object): void {
    if (focusedCollectionInputHandleRef.current === nativeHandle) {
      focusedCollectionInputHandleRef.current = null;
    }
  }

  function renderCreateRow(depth: number) {
    return (
      <View style={[styles.sidebarCreateRow, { marginLeft: 6 + Math.min(depth, 2) * 18 }]}>
        <TextInput
          autoFocus
          value={newCollectionName}
          onChangeText={setNewCollectionName}
          onSubmitEditing={() => void createCollection()}
          editable={!savingCollection}
          maxLength={60}
          returnKeyType="done"
          placeholder={creatingParentId ? "子生活集名称" : "生活集名称"}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={(event) => keepCollectionInputVisible(event.target)}
          onBlur={(event) => clearFocusedCollectionInput(event.target)}
          style={styles.sidebarCreateInput}
        />
        <Pressable accessibilityLabel="完成新建生活集" disabled={!newCollectionName.trim() || savingCollection} hitSlop={8} onPress={() => void createCollection()}>
          {savingCollection
            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            : <Ionicons name="checkmark-outline" size={22} color={newCollectionName.trim() ? theme.colors.text : theme.colors.textMuted} />}
        </Pressable>
        <Pressable
          accessibilityLabel="取消新建生活集"
          disabled={savingCollection}
          hitSlop={8}
          onPress={() => {
            setCreatingParentId(undefined);
            setNewCollectionName("");
          }}
        >
          <Ionicons name="close-outline" size={22} color={theme.colors.textMuted} />
        </Pressable>
      </View>
    );
  }

  function renderCollectionTree(parentId: string | null, depth: number): React.ReactNode {
    const siblings = orderedCollections.filter((collection) => collection.parentId === parentId);
    return siblings.map((collection) => renderCollectionNode(collection, depth));
  }

  function renderCollectionNode(collection: CardCollection, depth: number, drag?: () => void, isActive = false): React.ReactNode {
    const children = orderedCollections.filter((candidate) => candidate.parentId === collection.id);
    const expanded = expandedCollectionIds.has(collection.id);
    return (
        <React.Fragment key={collection.id}>
          {renamingCollectionId === collection.id ? (
            <View style={[styles.sidebarCreateRow, { marginLeft: 6 + Math.min(depth, 2) * 18 }]}>
              <TextInput
                autoFocus
                value={renameValue}
                onChangeText={setRenameValue}
                onSubmitEditing={() => void submitRename()}
                editable={!savingRename}
                maxLength={60}
                returnKeyType="done"
                selectTextOnFocus
                onFocus={(event) => keepCollectionInputVisible(event.target)}
                onBlur={(event) => clearFocusedCollectionInput(event.target)}
                style={styles.sidebarCreateInput}
              />
              <Pressable accessibilityLabel="确认重命名" disabled={!renameValue.trim() || savingRename} hitSlop={8} onPress={() => void submitRename()}>
                {savingRename
                  ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                  : <Ionicons name="checkmark-outline" size={22} color={renameValue.trim() ? theme.colors.text : theme.colors.textMuted} />}
              </Pressable>
              <Pressable accessibilityLabel="取消重命名" disabled={savingRename} hitSlop={8} onPress={cancelRenaming}>
                <Ionicons name="close-outline" size={22} color={theme.colors.textMuted} />
              </Pressable>
            </View>
          ) : (
            <SidebarRow
              label={collection.name}
              selected={activeView === collection.id}
              depth={depth}
              expandable={children.length > 0}
              expanded={expanded}
              onToggle={() => toggleExpanded(collection.id)}
              favorite={collection.isFavorite}
              favoriteSaving={favoriteSavingId === collection.id}
              onToggleFavorite={() => void toggleFavorite(collection)}
              onMore={() => openCollectionActions(collection)}
              drag={drag}
              dragActive={isActive}
              onPress={() => onSelect(collection.id)}
            />
          )}
          {creatingParentId === collection.id ? renderCreateRow(depth + 1) : null}
          {expanded ? renderCollectionTree(collection.id, depth + 1) : null}
        </React.Fragment>
    );
  }

  return (
    <AnimatedSidebarModal visible={visible} onRequestClose={onClose}>
        <KeyboardAvoidingView behavior="height" style={[styles.sidebar, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
          <View style={styles.sidebarHeader}>
            <Pressable accessibilityLabel={t("sidebar.settings")} style={styles.sidebarAccount} onPress={onOpenAccount}>
              <View style={styles.sidebarAvatar}>
                {profile?.avatar?.thumbnailUrl
                  ? <Image source={{ uri: profile.avatar.thumbnailUrl }} style={styles.sidebarAvatarImage} />
                  : <Ionicons name="person-outline" size={19} color={theme.colors.textSecondary} />}
              </View>
              <View style={styles.sidebarAccountText}>
                <View style={styles.sidebarAccountNameRow}>
                  <Text numberOfLines={1} style={styles.sidebarAccountName}>{profile?.nickname?.trim() || "OIO"}</Text>
                  {entitlement?.tier === "pro" || entitlement?.tier === "plus" ? (
                    <View style={styles.sidebarMembershipBadge}>
                      <Text style={styles.sidebarMembershipBadgeText}>{entitlement.tier === "pro" ? "PRO" : "PLUS"}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
            <Pressable accessibilityLabel={t("sidebar.settings")} style={styles.sidebarSettingsButton} onPress={onOpenAccount}>
              <Ionicons name="settings-outline" size={21} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <CalendarSidebarPreview onPress={onOpenCalendar} />
          <View style={styles.sidebarFixedContent}>
            <SidebarRow
              leading={<OioCharacter width={27} height={25} />}
              label={t("contact.curious_companion.name")}
              muted={!assistantAvailable}
              onPress={assistantAvailable ? onOpenAssistant : () => Alert.alert(t("sidebar.assistant_members_only_title"), t("sidebar.assistant_members_only_message"))}
            />
            <SidebarRow icon="time-outline" label={t("sidebar.recall")} onPress={onOpenRecall} />
          </View>

          <View style={styles.sidebarCollectionSection}>
            <NestableScrollContainer
              ref={collectionScrollRef}
              style={styles.sidebarCollectionScroller}
              contentContainerStyle={styles.sidebarCollectionContent}
              alwaysBounceVertical={false}
              bounces={collections.length > 7}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sidebarSectionHeader}>
                <Pressable
                  accessibilityLabel={favoritesExpanded ? t("sidebar.a11y.collapse_favorites") : t("sidebar.a11y.expand_favorites")}
                  style={styles.sidebarSectionToggle}
                  onPress={() => setFavoritesExpanded((expanded) => !expanded)}
                >
                  <Ionicons name={favoritesExpanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
                  <Text style={styles.sidebarSectionTitle}>{t("sidebar.favorites")}</Text>
                </Pressable>
              </View>
              {favoritesExpanded ? (
                <NestableDraggableFlatList
                  data={favoriteCollections}
                  keyExtractor={(collection) => `favorite-${collection.id}`}
                  keyboardShouldPersistTaps="always"
                  activationDistance={3}
                  animationConfig={COLLECTION_DRAG_ANIMATION}
                  onDragBegin={(index) => beginNativeCollectionDrag(favoriteCollections[index]?.id)}
                  onDragEnd={({ data, from, to }) => void commitFavoriteReorder(data, from, to)}
                  renderItem={({ item, drag, isActive }: RenderItemParams<CardCollection>) => (
                      <SidebarRow label={item.name} selected={activeView === item.id} favorite favoriteSaving={favoriteSavingId === item.id} onToggleFavorite={() => void toggleFavorite(item)} drag={collectionDragLocked && !isActive ? undefined : drag} dragActive={isActive} onPress={() => onSelect(item.id)} />
                  )}
                />
              ) : null}

              <View style={[styles.sidebarSectionHeader, styles.sidebarLifeSectionHeader, activeView === "all" && styles.sidebarSectionHeaderSelected]}>
                <Pressable
                  accessibilityLabel={collectionsExpanded ? t("sidebar.a11y.collapse_collections") : t("sidebar.a11y.expand_collections")}
                  style={styles.sidebarSectionDisclosureButton}
                  onPress={() => setCollectionsExpanded((expanded) => !expanded)}
                >
                  <Ionicons name={collectionsExpanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
                </Pressable>
                <Pressable accessibilityLabel={t("sidebar.collections")} style={styles.sidebarSectionSelect} onPress={() => onSelect("all")}>
                  <Text style={[styles.sidebarSectionTitle, activeView === "all" && styles.sidebarSectionTitleSelected]}>{t("sidebar.collections")}</Text>
                </Pressable>
                <View style={styles.sidebarSectionActions}>
                  <Pressable
                    accessibilityLabel={creatingParentId === null ? t("sidebar.a11y.cancel_new_collection") : t("sidebar.a11y.new_collection")}
                    style={styles.sidebarSectionAction}
                    hitSlop={8}
                    onPress={() => {
                      if (creatingParentId === null) {
                        setCreatingParentId(undefined);
                        setNewCollectionName("");
                      } else {
                        setCollectionsExpanded(true);
                        beginCreating(null);
                      }
                    }}
                  >
                    <Ionicons name={creatingParentId === null ? "close-outline" : "add-outline"} size={23} color={theme.colors.text} />
                  </Pressable>
                </View>
              </View>
              {collectionsExpanded ? (
                <>
                  <SidebarRow
                    label={t("sidebar.unclassified")}
                    selected={activeView === UNCLASSIFIED_VIEW}
                    depth={0}
                    onPress={() => onSelect(UNCLASSIFIED_VIEW)}
                  />
                  {creatingParentId === null ? renderCreateRow(0) : null}
                  <NestableDraggableFlatList
                    data={orderedCollections.filter((collection) => collection.parentId === null)}
                    keyExtractor={(collection) => collection.id}
                    keyboardShouldPersistTaps="always"
                    activationDistance={3}
                    animationConfig={COLLECTION_DRAG_ANIMATION}
                    onDragBegin={(index) => beginNativeCollectionDrag(orderedCollections.filter((collection) => collection.parentId === null)[index]?.id)}
                    onDragEnd={({ data, from, to }) => void commitNativeReorder(null, data, from, to)}
                    renderItem={({ item, drag, isActive }: RenderItemParams<CardCollection>) => (
                      <>{renderCollectionNode(item, 0, collectionDragLocked && !isActive ? undefined : drag, isActive)}</>
                    )}
                  />
                </>
              ) : null}
            </NestableScrollContainer>
          </View>
        </KeyboardAvoidingView>
    </AnimatedSidebarModal>
  );
}

function AnimatedSidebarModal({ visible, onRequestClose, children }: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const translateX = useRef(new Animated.Value(-380)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const animationSequenceRef = useRef(0);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx < -10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => gesture.dx < -14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
    onPanResponderGrant: () => { translateX.stopAnimation(); scrimOpacity.stopAnimation(); },
    onPanResponderMove: (_event, gesture) => {
      const distance = Math.max(-380, Math.min(0, gesture.dx));
      translateX.setValue(distance);
      scrimOpacity.setValue(Math.max(0, 1 + distance / 380));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx < -72 || gesture.vx < -0.55) {
        onRequestClose();
        return;
      }
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, damping: 24, stiffness: 250, mass: 0.9, useNativeDriver: true }),
        Animated.timing(scrimOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    },
    onPanResponderTerminate: () => {
      Animated.parallel([
        Animated.spring(translateX, { toValue: 0, damping: 24, stiffness: 250, mass: 0.9, useNativeDriver: true }),
        Animated.timing(scrimOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]).start();
    },
  }), [onRequestClose, scrimOpacity, translateX]);

  useEffect(() => {
    const sequence = ++animationSequenceRef.current;
    translateX.stopAnimation();
    scrimOpacity.stopAnimation();
    if (visible) {
      setMounted(true);
      requestAnimationFrame(() => {
        if (animationSequenceRef.current !== sequence) return;
        Animated.parallel([
          Animated.spring(translateX, { toValue: 0, damping: 24, stiffness: 240, mass: 0.9, useNativeDriver: true }),
          Animated.timing(scrimOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      });
      return;
    }
    if (!mounted) return;
    Animated.parallel([
      Animated.timing(translateX, { toValue: -380, duration: 210, useNativeDriver: true }),
      Animated.timing(scrimOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && animationSequenceRef.current === sequence) setMounted(false);
    });
  }, [scrimOpacity, translateX, visible]);

  if (!mounted) return null;
  return (
    <View style={styles.sidebarOverlay}>
      <Animated.View style={[styles.sidebarAnimatedScrim, { opacity: scrimOpacity }]}>
        <Pressable accessibilityLabel={t("sidebar.a11y.close")} style={StyleSheet.absoluteFill} onPress={onRequestClose} />
      </Animated.View>
      <Animated.View {...panResponder.panHandlers} style={[styles.sidebarAnimatedContent, { transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

function SidebarRow({ icon, leading, label, count, selected = false, muted = false, onPress, depth = 0, expandable = false, expanded = false, onToggle, favorite, favoriteSaving = false, onToggleFavorite, onMore, drag, dragActive = false }: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  leading?: React.ReactNode;
  label: string;
  count?: number;
  selected?: boolean;
  muted?: boolean;
  onPress: () => void;
  depth?: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  favorite?: boolean;
  favoriteSaving?: boolean;
  onToggleFavorite?: () => void;
  onMore?: () => void;
  drag?: () => void;
  dragActive?: boolean;
}) {
  return (
    <Pressable
      delayLongPress={140}
      disabled={dragActive}
      style={[styles.sidebarRow, dragActive && styles.sidebarRowDragging, muted && styles.sidebarRowMuted, { paddingLeft: 14 + Math.min(depth, 2) * 18 }, selected && styles.sidebarRowSelected]}
      onLongPress={drag}
      onPress={onPress}
    >
      {selected ? <View pointerEvents="none" style={styles.sidebarSelectionMark} /> : null}
      <Pressable accessibilityLabel={expanded ? "折叠生活集" : "展开生活集"} disabled={!expandable} style={styles.sidebarDisclosure} onPress={(event) => { event.stopPropagation(); onToggle?.(); }}>
        {expandable ? <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} /> : null}
      </Pressable>
      {icon ? <Ionicons name={icon} size={19} color={muted ? theme.colors.textMuted : selected ? "#111111" : "#555555"} /> : null}
      {leading ? <View style={muted && styles.sidebarLeadingMuted}>{leading}</View> : null}
      <Text numberOfLines={1} style={[styles.sidebarRowLabel, muted && styles.sidebarRowLabelMuted, selected && styles.sidebarRowLabelSelected]}>{label}</Text>
      {count !== undefined ? <Text style={styles.sidebarRowCount}>{count}</Text> : null}
      {onToggleFavorite ? (
        <Pressable
          accessibilityLabel={favorite ? `取消收藏${label}` : `收藏${label}`}
          disabled={favoriteSaving}
          style={styles.sidebarRowFavorite}
          hitSlop={5}
          onPress={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
        >
          {favoriteSaving
            ? <ActivityIndicator size="small" color={theme.colors.textMuted} />
            : <Ionicons name={favorite ? "star" : "star-outline"} size={18} color={favorite ? "#C89B2B" : theme.colors.textMuted} />}
        </Pressable>
      ) : null}
      {onMore ? (
        <Pressable
          accessibilityLabel={`${label}的更多操作`}
          style={styles.sidebarRowAction}
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            onMore();
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={19} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function collectionPathName(collection: CardCollection, collections: CardCollection[]): string {
  const names = [collection.name];
  let parentId = collection.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = collections.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

function CardSearchScreen({ query, results, searching, collections, collectionId, onClose, onQueryChange, onSearch, onCollectionChange, onOpenResult }: {
  query: string;
  results: RecallCandidate[] | null;
  searching: boolean;
  collections: CardCollection[];
  collectionId: string | null | undefined;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onCollectionChange: (value: string | null | undefined) => void;
  onOpenResult: (recordId: string) => void;
}) {
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 230);
    return () => clearTimeout(timer);
  }, []);
  const selectedCollection = collectionId ? collections.find((collection) => collection.id === collectionId) : null;
  const collectionLabel = collectionId === undefined ? t("sidebar.collections") : collectionId === null ? t("sidebar.unclassified") : selectedCollection ? collectionPathName(selectedCollection, collections) : "分类";
  return <SafeAreaView style={styles.searchPage}>
    <View style={styles.searchPageHeader}>
      <Pressable accessibilityLabel="返回" style={styles.searchBackButton} onPress={onClose}><Ionicons name="chevron-back" size={25} color={theme.colors.text} /></Pressable>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={theme.colors.textMuted} />
        <TextInput ref={inputRef} value={query} onChangeText={onQueryChange} onSubmitEditing={onSearch} returnKeyType="search" style={styles.searchPageInput} />
        {query ? <Pressable accessibilityLabel="清空搜索" hitSlop={8} onPress={() => onQueryChange("")}><Ionicons name="close-circle" size={19} color={theme.colors.textMuted} /></Pressable> : null}
      </View>
      <Pressable accessibilityLabel="搜索" disabled={!query.trim() || searching} style={[styles.searchPageSubmit, (!query.trim() || searching) && styles.searchPageSubmitDisabled]} onPress={onSearch}>
        {searching ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />}
      </Pressable>
    </View>
    <View style={styles.searchFilters}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilterContent}>
        <Pressable style={[styles.searchFilterChip, collectionId !== undefined && styles.searchFilterChipActive]} onPress={() => setCollectionPickerVisible(true)}>
          <Ionicons name={collectionId === undefined ? "apps-outline" : "folder-outline"} size={14} color={collectionId !== undefined ? theme.colors.text : theme.colors.textSecondary} />
          <Text numberOfLines={1} style={[styles.searchFilterText, collectionId !== undefined && styles.searchFilterTextActive]}>{collectionLabel}</Text>
          <Ionicons name="chevron-down" size={13} color={theme.colors.textMuted} />
        </Pressable>
      </ScrollView>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.searchResultsContent} showsVerticalScrollIndicator={false}>
      {results ? <Text style={styles.searchSummary}>{results.length ? `找到 ${results.length} 条相关记录` : `没有找到“${query.trim()}”`}</Text> : <View style={styles.searchStart}><Ionicons name="search-outline" size={30} color="#C1C1C1" /><Text style={styles.searchStartText}>搜索原文、AI 改写和学过的表达</Text></View>}
      {results?.map((result) => <SearchResultCard key={result.recordId} result={result} query={query} onPress={() => onOpenResult(result.recordId)} />)}
      {results && !results.length ? <Text style={styles.searchEmptyHint}>换一个关键词，或者调整时间和生活集范围。</Text> : null}
    </ScrollView>
    <CollectionPickerModal visible={collectionPickerVisible} title="选择分类" collections={collections} value={collectionId} includeAll onClose={() => setCollectionPickerVisible(false)} onSelect={(value) => { setCollectionPickerVisible(false); onCollectionChange(value); }} />
  </SafeAreaView>;
}

function AnimatedSearchOverlay({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const sequenceRef = useRef(0);
  useEffect(() => {
    const sequence = ++sequenceRef.current;
    progress.stopAnimation();
    if (visible) {
      setMounted(true);
      requestAnimationFrame(() => {
        if (sequenceRef.current !== sequence) return;
        Animated.timing(progress, { toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      });
      return;
    }
    if (!mounted) return;
    Animated.timing(progress, { toValue: 0, duration: 190, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished && sequenceRef.current === sequence) setMounted(false);
    });
  }, [mounted, progress, visible]);
  if (!mounted) return null;
  return <Animated.View style={[styles.searchOverlay, { opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }] }]}>{children}</Animated.View>;
}

function SearchResultCard({ result, query, onPress }: { result: RecallCandidate; query: string; onPress: () => void }) {
  const match = result.matches?.[0];
  const fieldLabel = match?.field === "title" || match?.field === "topic"
    ? "相关内容"
    : match?.field === "original"
      ? "原文"
      : match?.field === "organization"
        ? "整理"
        : match?.field === "reply"
          ? "回复"
          : "自然表达";
  return (
    <Pressable style={styles.searchResultCard} onPress={onPress}>
      <View style={styles.cardContent}>
        {result.thumbnail ? <View style={styles.thumbnailFrame}><Image source={{ uri: result.thumbnail.url }} resizeMode="cover" style={styles.thumbnail} /></View> : null}
        <View style={styles.cardTextColumn}>
          {match?.field === "title" || match?.field === "topic"
            ? <HighlightedSearchText text={result.displayTitle} term={match.surfaceText || query} />
            : <Text numberOfLines={1} style={styles.cardTitle}>{result.displayTitle}</Text>}
          {match?.field === "title" || match?.field === "topic"
            ? <Text numberOfLines={2} style={styles.originalText}>{result.originalText}</Text>
            : <HighlightedSearchText text={match?.sentence || result.originalText} term={match?.surfaceText || query} />}
          <View style={styles.cardFooter}>
            <Text style={styles.cardTime}>{formatSearchResultDate(result.createdAt)}</Text>
            <Text style={styles.searchMatchLabel}>{fieldLabel}{match?.matchType === "variant" ? " · 词形" : ""}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function HighlightedSearchText({ text, term }: { text: string; term: string }) {
  const index = text.toLocaleLowerCase().indexOf(term.trim().toLocaleLowerCase());
  if (index < 0 || !term.trim()) return <Text numberOfLines={3} style={styles.rewrittenText}>{text}</Text>;
  return <Text numberOfLines={3} style={styles.rewrittenText}>{text.slice(0, index)}<Text style={styles.searchHighlight}>{text.slice(index, index + term.trim().length)}</Text>{text.slice(index + term.trim().length)}</Text>;
}

function formatSearchResultDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatQuotaRefreshTime(value: string | null): string {
  if (!value) return t("me.quota.next_period");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("me.quota.next_period");
  return date.toLocaleString(getLanguage(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CollectionMoveModal({ visible, collections, collectionId, onClose, onMove }: {
  visible: boolean;
  collections: CardCollection[];
  collectionId: string | null;
  onClose: () => void;
  onMove: (collectionId: string, parentId: string | null) => Promise<void>;
}) {
  const [movingTo, setMovingTo] = useState<string | null | undefined>(undefined);
  const moving = collections.find((collection) => collection.id === collectionId) ?? null;
  const move = async (parentId: string | null) => {
    if (!moving || movingTo !== undefined || moving.parentId === parentId) {
      if (moving?.parentId === parentId) onClose();
      return;
    }
    setMovingTo(parentId);
    try {
      await onMove(moving.id, parentId);
      onClose();
    } catch (error) {
      Alert.alert("无法移动生活集", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setMovingTo(undefined);
    }
  };
  const unavailableIds = moving ? collectionDescendantIds(moving.id, collections) : new Set<string>();
  if (moving) unavailableIds.add(moving.id);
  const moveTargets = collectionTreeRows(collections).filter(({ collection }) => !unavailableIds.has(collection.id));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalPage}>
        <View style={styles.modalHeader}>
          <Pressable style={styles.modalHeaderButton} onPress={onClose}><Text style={styles.modalCancel}>取消</Text></Pressable>
          <Text style={styles.modalTitle}>{moving ? `移动“${moving.name}”` : "移动到"}</Text>
          <View style={styles.modalHeaderButton} />
        </View>
        <ScrollView contentContainerStyle={styles.collectionManagerList} alwaysBounceVertical={false}>
          {moving ? (
            <>
              <Text style={styles.collectionMoveHint}>选择新的所属生活集</Text>
              <Pressable style={styles.collectionMoveRow} onPress={() => void move(null)}>
                <Ionicons name="albums-outline" size={20} color={theme.colors.textSecondary} />
                <Text style={styles.collectionRowName}>生活集顶层</Text>
                {moving.parentId === null ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                {movingTo === null ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
              </Pressable>
              {moveTargets.map(({ collection, depth }) => (
                <Pressable key={collection.id} style={[styles.collectionMoveRow, { paddingLeft: 12 + depth * 20 }]} onPress={() => void move(collection.id)}>
                  <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
                  <Text style={styles.collectionRowName}>{collection.name}</Text>
                  {moving.parentId === collection.id ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                  {movingTo === collection.id ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function collectionTreeRows(collections: CardCollection[]): Array<{ collection: CardCollection; depth: number }> {
  const rows: Array<{ collection: CardCollection; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    collections
      .filter((collection) => collection.parentId === parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .forEach((collection) => {
        rows.push({ collection, depth });
        visit(collection.id, depth + 1);
      });
  };
  visit(null, 0);
  return rows;
}

function collectionDescendantIds(collectionId: string, collections: CardCollection[]): Set<string> {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    collections.filter((collection) => collection.parentId === parentId).forEach((collection) => {
      if (descendants.has(collection.id)) return;
      descendants.add(collection.id);
      visit(collection.id);
    });
  };
  visit(collectionId);
  return descendants;
}

async function stabilizeRecordThumbnails(
  previousRecords: CardRecordSummary[],
  nextRecords: CardRecordSummary[],
): Promise<CardRecordSummary[]> {
  const previousById = new Map(previousRecords.map((record) => [record.id, record]));
  return Promise.all(nextRecords.map(async (record) => {
    const previousThumbnail = previousById.get(record.id)?.thumbnail;
    if (!record.thumbnail) return record;
    const stableThumbnail = await stabilizeSignedImage(previousThumbnail, record.thumbnail, THUMBNAIL_REFRESH_LEAD_MS);
    return {
      ...record,
      thumbnail: {
        ...record.thumbnail,
        url: stableThumbnail.url,
        urlExpiresAt: stableThumbnail.urlExpiresAt,
      },
    };
  }));
}

function CardCard({ record, collectionName, selecting = false, selected = false, onPress, onOpenActions, onThumbnailError }: {
  record: CardRecordSummary;
  collectionName?: string;
  selecting?: boolean;
  selected?: boolean;
  onPress: (origin?: CardDetailRequest["origin"]) => void;
  onOpenActions: (anchor: RecordActionAnchor) => void;
  onThumbnailError: () => void;
}) {
  const processing = record.status !== "completed";
  const previewText = record.rewrittenPreview?.trim() || record.originalPreview;
  const thumbnailRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const moreButtonRef = useRef<View>(null);
  function measureOrigin(onMeasured: (origin: NonNullable<CardDetailRequest["origin"]>) => void): void {
    const target = record.thumbnail ? thumbnailRef.current : cardRef.current;
    target?.measureInWindow((x, y, width, height) => {
      onMeasured({ x, y, width, height });
    });
  }
  function open(): void {
    if (processing) return;
    const target = record.thumbnail ? thumbnailRef.current : cardRef.current;
    if (!target) {
      onPress();
      return;
    }
    measureOrigin(onPress);
  }
  return (
    <Pressable ref={cardRef} style={[styles.card, selected && styles.cardSelected]} disabled={processing} accessibilityState={{ disabled: processing, selected }} onPress={open}>
      <View style={styles.cardContent}>
        {selecting ? <View style={styles.cardSelectionIcon}><Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={23} color={selected ? theme.colors.text : theme.colors.textMuted} /></View> : null}
        {record.thumbnail ? <View ref={thumbnailRef} collapsable={false} style={styles.thumbnailFrame}><Image source={{ uri: record.thumbnail.url }} resizeMode="cover" style={styles.thumbnail} onError={onThumbnailError} /></View> : null}
        <View style={styles.cardTextColumn}>
          {processing ? (
            <>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.cardTitle}>{record.displayTitle}</Text>
              <Text numberOfLines={record.thumbnail ? 2 : 3} ellipsizeMode="tail" style={styles.originalText}>{previewText}</Text>
              <Text style={styles.processingText}>整理中</Text>
            </>
          ) : (
            <>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.cardTitle}>{record.displayTitle}</Text>
              <Text numberOfLines={record.thumbnail ? 2 : 3} ellipsizeMode="tail" style={styles.originalText}>{previewText}</Text>
            </>
          )}
          <View style={styles.cardFooter}>
            <Text numberOfLines={1} style={styles.cardTime}>{formatCardDateLabel(record.dateKey)} · {formatTime(record.createdAt)}</Text>
            {collectionName ? <Text numberOfLines={1} style={styles.cardCollection}>{collectionName}</Text> : null}
            {record.isSample ? <Text style={styles.sampleBadge}>示例</Text> : null}
            {processing ? <ActivityIndicator size="small" color={theme.colors.accent} /> : !selecting ? (
              <Pressable ref={moreButtonRef} accessibilityLabel={t("quick_note.actions")} style={styles.cardMoreButton} hitSlop={8} onPress={(event) => {
                event.stopPropagation();
                moreButtonRef.current?.measureInWindow((x, y, width, height) => onOpenActions({ x, y, width, height }));
              }}>
                <Ionicons name="ellipsis-horizontal" size={19} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function countGraphemes(value: string): number {
  const normalized = value.replace(/\r\n?/gu, "\n");
  const Segmenter = (Intl as unknown as { Segmenter?: new (...args: unknown[]) => { segment: (text: string) => Iterable<unknown> } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(normalized)).length : Array.from(normalized).length;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCardDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const now = new Date();
  if (dateKey === toDateKey(now)) return t("common.today");
  return new Intl.DateTimeFormat(getLanguage(), {
    ...(year === now.getFullYear() ? {} : { year: "numeric" as const }),
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" });
}

const editorialFont = Platform.select({ ios: "STSongti-SC-Regular", android: "serif", default: "serif" });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.canvas },
  brandRow: { minHeight: 52, paddingHorizontal: 16, paddingTop: 3, flexDirection: "row", alignItems: "center" },
  brand: { flex: 1, marginLeft: 10, color: theme.colors.text, fontSize: 20, lineHeight: 27, fontWeight: "500", letterSpacing: -0.2 },
  homeSectionTabs: { flex: 1, height: 48, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  homeHeaderTitle: { maxWidth: "86%", color: theme.colors.text, fontSize: 17, lineHeight: 23, fontWeight: "600" },
  selectionHeaderTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  headerDate: { color: theme.colors.textMuted, fontSize: 13 },
  headerActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 2 },
  recordButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center", gap: 5 },
  recordButtonText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  headerIconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  libraryMenuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.12)" },
  libraryMenuPanel: { position: "absolute", alignSelf: "center", width: 300, borderRadius: 18, backgroundColor: theme.colors.surface, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  libraryMenuRow: { minHeight: 76, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 10 },
  libraryMenuLeadingIcon: { width: 28, alignItems: "center" },
  libraryMenuTextBlock: { flex: 1 },
  libraryMenuTrailingIcon: { width: 22, alignItems: "center" },
  libraryMenuTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 24, fontWeight: "500" },
  libraryMenuOptionText: { color: theme.colors.text, fontSize: 15, lineHeight: 21, fontWeight: "500" },
  libraryMenuSubtitle: { marginTop: 2, color: theme.colors.textMuted, fontSize: 14, lineHeight: 19 },
  libraryMenuDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 18, backgroundColor: theme.colors.border },
  libraryContextRow: { minHeight: 44, paddingHorizontal: 22, paddingTop: 5, paddingBottom: 8, justifyContent: "center" },
  libraryContextTitle: { color: theme.colors.text, fontSize: 20, lineHeight: 27, fontWeight: "500", letterSpacing: -0.2 },
  librarySection: { minHeight: 44, marginBottom: 20, paddingLeft: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "flex-start" },
  collectionScroller: { flex: 1 },
  collectionTabs: { paddingRight: 20, gap: 26 },
  collectionChip: { maxWidth: 180, minHeight: 36, paddingTop: 2, paddingBottom: 9, borderBottomWidth: 2, borderBottomColor: "transparent", alignItems: "center", justifyContent: "center" },
  collectionChipSelected: { borderBottomColor: theme.colors.text },
  collectionChipText: { color: theme.colors.textMuted, fontSize: 14, letterSpacing: 0.15 },
  collectionChipTextSelected: { color: theme.colors.text, fontWeight: "500" },
  searchRow: { marginHorizontal: 20, marginBottom: 18, minHeight: 46, paddingLeft: 13, paddingRight: 4, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, minHeight: 44, color: theme.colors.text, fontSize: 14 },
  searchSubmit: { minWidth: 58, height: 38, paddingHorizontal: 11, borderRadius: 10, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  searchSubmitText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  libraryList: { flex: 1 },
  list: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 96 },
  recallShortcuts: { marginBottom: 8, paddingVertical: 6, flexDirection: "row", gap: 7 },
  recallShortcut: { flex: 1, minHeight: 44, paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  recallShortcutTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "500" },
  batchActionBar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 64, paddingTop: 8, paddingHorizontal: 62, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", justifyContent: "space-between" },
  batchAction: { minWidth: 72, minHeight: 46, alignItems: "center", justifyContent: "center", gap: 2 },
  batchActionText: { color: theme.colors.text, fontSize: 11 },
  loader: { marginVertical: 32 },
  loadMoreIndicator: { marginVertical: 20 },
  searchSummary: { marginBottom: 10, color: theme.colors.textMuted, fontSize: 12 },
  searchOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 50, backgroundColor: theme.colors.canvas },
  searchPage: { flex: 1, backgroundColor: theme.colors.canvas },
  searchPageHeader: { minHeight: 62, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchBackButton: { width: 34, height: 42, alignItems: "flex-start", justifyContent: "center" },
  searchBox: { flex: 1, height: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#F1F1F1", flexDirection: "row", alignItems: "center", gap: 8 },
  searchPageInput: { flex: 1, height: 44, paddingVertical: 0, color: theme.colors.text, fontSize: 15 },
  searchPageSubmit: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#171717", alignItems: "center", justifyContent: "center" },
  searchPageSubmitDisabled: { opacity: 0.35 },
  searchFilters: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5E5" },
  searchFilterContent: { paddingLeft: 54, paddingRight: 20, paddingTop: 7, paddingBottom: 13, gap: 8 },
  searchFilterChip: { maxWidth: 180, height: 34, paddingHorizontal: 11, borderWidth: 1, borderColor: "#E0E0E0", borderRadius: 17, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  searchFilterChipActive: { borderColor: "#BDBDBD", backgroundColor: "#ECECEC" },
  searchFilterText: { color: theme.colors.textSecondary, fontSize: 12 },
  searchFilterTextActive: { color: theme.colors.text, fontWeight: "600" },
  searchResultsContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 60 },
  searchStart: { paddingTop: 90, alignItems: "center", gap: 12 },
  searchStartText: { color: theme.colors.textMuted, fontSize: 13 },
  searchEmptyHint: { marginTop: 22, color: theme.colors.textMuted, textAlign: "center", fontSize: 13 },
  searchResultCard: { width: "100%", paddingVertical: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E7E7E7" },
  searchResultMeta: { marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 7 },
  searchResultBody: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchResultDate: { marginLeft: "auto", color: theme.colors.textMuted, fontSize: 11 },
  matchField: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: theme.radius.pill, overflow: "hidden", backgroundColor: "#EEEEEE", color: theme.colors.textSecondary, fontSize: 10, fontWeight: "600" },
  matchVariant: { color: theme.colors.textMuted, fontSize: 11 },
  matchSentence: { flex: 1, color: theme.colors.text, fontSize: 16, lineHeight: 24 },
  searchHighlight: { color: "#111111", backgroundColor: "#F5E8B5", fontWeight: "600" },
  searchMatchLabel: { marginRight: 8, color: "#8A8A8A", fontSize: 10 },
  searchResultOriginal: { marginTop: 8, color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  emptyCard: { marginTop: 14, paddingVertical: 52, paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, alignItems: "center" },
  emptyTitle: { color: theme.colors.text, textAlign: "center", fontSize: 18, lineHeight: 25, fontWeight: "500" },
  emptyText: { maxWidth: 280, marginTop: 9, color: theme.colors.textMuted, textAlign: "center", fontSize: 14, lineHeight: 21 },
  emptyAction: { marginTop: 22, minHeight: 46, paddingHorizontal: 18, borderRadius: 10, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  emptyActionText: { color: theme.colors.surface, fontSize: 14, fontWeight: "600" },
  card: { width: "100%", paddingVertical: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E7E7E7" },
  cardSelected: { backgroundColor: "#F4F4F4" },
  cardSelectionIcon: { width: 28, alignItems: "flex-start", justifyContent: "center" },
  cardFooter: { marginTop: 12, minHeight: 22, flexDirection: "row", alignItems: "center" },
  cardTime: { flex: 1, color: "#8A8A8A", fontSize: 11, lineHeight: 16, fontWeight: "400", letterSpacing: 0.1 },
  cardCollection: { maxWidth: 100, marginRight: 6, color: "#8A8A8A", fontSize: 11, lineHeight: 16 },
  cardMoreButton: { width: 32, height: 24, alignItems: "flex-end", justifyContent: "center" },
  recordActionLayer: { ...StyleSheet.absoluteFillObject, zIndex: 80 },
  recordActionMenu: { position: "absolute", width: 128, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  recordActionItem: { height: 40, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  recordActionText: { color: theme.colors.text, fontSize: 13, fontWeight: "500" },
  recordActionDanger: { color: theme.colors.danger },
  recordActionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: theme.colors.border },
  sampleBadge: { marginRight: 8, color: "#8A8A8A", fontSize: 10 },
  cardContent: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 14 },
  cardTextColumn: { flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" },
  cardTitle: { color: "#171717", fontSize: 17, lineHeight: 23, fontWeight: "600" },
  thumbnailFrame: { width: 108, height: 72, flexShrink: 0, borderRadius: 9, overflow: "hidden", backgroundColor: "#F1F1F1" },
  thumbnail: { width: "100%", height: "100%", backgroundColor: "#F1F1F1" },
  originalText: { marginTop: 4, color: "#777777", fontFamily: editorialFont, fontSize: 13, lineHeight: 19, fontWeight: "400", letterSpacing: 0.02 },
  divider: { marginVertical: 10, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  rewrittenText: { color: "#171717", fontSize: 17, lineHeight: 25, fontWeight: "400" },
  cardDate: { marginTop: 9, color: theme.colors.textMuted, fontSize: 11 },
  processingText: { marginTop: 6, color: "#999999", fontSize: 11, lineHeight: 17 },
  floatingRecordButton: { position: "absolute", right: 20, bottom: 20, width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: "#D8D8D8", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  modalPage: { flex: 1, backgroundColor: theme.colors.canvas },
  modalHeader: { minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  modalHeaderButton: { width: 62, minHeight: 44, alignItems: "center", justifyContent: "center" },
  modalTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  modalTitleSpacer: { flex: 1 },
  modalCancel: { color: theme.colors.textSecondary, fontSize: 15 },
  modalSend: { color: theme.colors.accentStrong, fontSize: 15, fontWeight: "600" },
  collectionEditor: { padding: 16, flexDirection: "row", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  collectionManagerList: { padding: 16, paddingBottom: 40 },
  collectionMoveHint: { paddingHorizontal: 12, paddingTop: 5, paddingBottom: 12, color: theme.colors.textMuted, fontSize: 13 },
  collectionMoveRow: { minHeight: 54, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  collectionRowName: { flex: 1, color: theme.colors.text, fontSize: 15 },
  sidebarOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 20 },
  sidebarAnimatedContent: { position: "absolute", top: 0, bottom: 0, left: 0, width: "84%", maxWidth: 360, zIndex: 2 },
  sidebarAnimatedScrim: { ...StyleSheet.absoluteFillObject, zIndex: 1, backgroundColor: "rgba(0, 0, 0, 0.24)" },
  sidebar: { flex: 1, width: "100%", backgroundColor: "#FFFFFF", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "#DADADA", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 6, height: 0 }, elevation: 10 },
  sidebarHeader: { minHeight: 66, paddingLeft: 20, paddingRight: 12, flexDirection: "row", alignItems: "center" },
  sidebarAccount: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center" },
  sidebarAvatar: { width: 38, height: 38, borderRadius: 19, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  sidebarAvatarImage: { width: 38, height: 38, borderRadius: 19 },
  sidebarAccountText: { flex: 1, minWidth: 0, marginLeft: 11 },
  sidebarAccountNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sidebarAccountName: { flexShrink: 1, color: "#1C1C1C", fontSize: 15, lineHeight: 21, fontWeight: "600" },
  sidebarMembershipBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#FFF3D8" },
  sidebarMembershipBadgeText: { color: "#B57B18", fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.3 },
  sidebarSettingsButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sidebarFixedContent: { paddingHorizontal: 10 },
  sidebarCollectionSection: { flex: 1, minHeight: 0, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E2E2E2" },
  sidebarCollectionScroller: { flex: 1 },
  sidebarCollectionContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 24 },
  sidebarRow: { position: "relative", minHeight: 46, paddingHorizontal: 12, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 11 },
  sidebarRowMuted: { opacity: 0.42 },
  sidebarLeadingMuted: { opacity: 0.55 },
  sidebarDisclosure: { width: 16, height: 32, marginRight: -7, alignItems: "center", justifyContent: "center" },
  sidebarRowSelected: { backgroundColor: "#F2F2F2" },
  sidebarSelectionMark: { position: "absolute", left: 0, top: 10, bottom: 10, width: 2, borderRadius: 1, backgroundColor: "#171717" },
  sidebarRowLabel: { flex: 1, minWidth: 0, color: "#202020", fontSize: 15, lineHeight: 21, fontWeight: "400", zIndex: 0 },
  sidebarRowLabelMuted: { color: theme.colors.textMuted },
  sidebarRowLabelSelected: { color: "#111111" },
  sidebarRowCount: { minWidth: 24, color: "#8A8A8A", fontSize: 12, textAlign: "right" },
  sidebarRowFavorite: { width: 28, height: 34, marginHorizontal: -4, zIndex: 2, elevation: 2, alignItems: "center", justifyContent: "center" },
  sidebarRowAction: { width: 28, height: 34, marginHorizontal: -5, zIndex: 2, elevation: 2, alignItems: "center", justifyContent: "center" },
  sidebarRowDragging: { backgroundColor: "#FFFFFF", borderRadius: 7, shadowColor: "#000000", shadowOpacity: 0.16, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  sidebarSectionHeader: { minHeight: 46, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarLifeSectionHeader: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E4E4E4" },
  sidebarSectionHeaderSelected: { borderRadius: 6, backgroundColor: "#F2F2F2" },
  sidebarSectionToggle: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  sidebarSectionDisclosureButton: { width: 22, minHeight: 46, alignItems: "flex-start", justifyContent: "center" },
  sidebarSectionSelect: { flex: 1, minHeight: 46, justifyContent: "center" },
  sidebarSectionTitle: { color: "#777777", fontSize: 15, lineHeight: 21, fontWeight: "400" },
  sidebarSectionTitleSelected: { color: "#202020" },
  sidebarSectionActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  sidebarSectionAction: { width: 34, height: 36, alignItems: "center", justifyContent: "center" },
  sidebarCreateRow: { minHeight: 46, marginHorizontal: 6, marginBottom: 4, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#CECECE", flexDirection: "row", alignItems: "center", gap: 10 },
  sidebarCreateInput: { flex: 1, minHeight: 42, paddingVertical: 0, color: "#171717", fontSize: 15 },
  sidebarEmpty: { paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.textMuted, fontSize: 13, lineHeight: 20 },
});
