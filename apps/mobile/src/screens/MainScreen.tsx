import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
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
import { KeyboardAvoidingView, KeyboardStickyView } from "react-native-keyboard-controller";
import Reanimated, { useAnimatedRef } from "react-native-reanimated";
import OioCharacter from "../../assets/app/oio-character.svg";
import OioRecall from "../../assets/app/oio-recall.svg";
import Sortable from "react-native-sortables";
import {
  createCardEntry,
  bootstrapCard,
  createCardCollection,
  deleteCardCollection,
  deleteCardRecord,
  getCardTrash,
  restoreCardRecord,
  permanentlyDeleteCardRecord,
  getCardCollections,
  getCardRecordPage,
  getCardTaskStatus,
  getCardRecord,
  getCardCapabilities,
  getCardInspirations,
  generateCardContent,
  updateCardContent,
  updateCardCoverPosition,
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
  CardImageModerationRejectedError,
} from "../services/card/cardImageUpload";
import { generateMissingCardContent, isCardResourceLimitedError, type CardGenerationTarget } from "../services/card/cardContentGeneration";
import { isCardGenerationInProgress, isCardRecordGenerationInProgress, setCardGenerationState, subscribeCardGenerationState } from "../services/card/cardGenerationState";
import { getLanguage, t, tf } from "../i18n";
import { CollectionPickerModal } from "./shared/CollectionPickerModal";
import { CalendarSidebarPreview, CardCalendarScreen } from "./CardCalendarScreen";
import { getCurrentEntitlement, getUserProfile, type CurrentEntitlement, type UserProfile } from "../services/api/meApi";
import { getSession } from "../services/auth/authStorage";
import { getCachedEntitlementForUser, setCachedEntitlement } from "../services/entitlement/entitlementCache";
import { stabilizeProfileAvatar, stabilizeSignedImage } from "../services/image/signedImageCache";
import { useRealtimeSttInput } from "../hooks/useRealtimeSttInput";
import { RealtimeSttButton } from "../components/RealtimeSttButton";
import { fallbackCardInspirations, loadCardInspirations, saveCardInspirations } from "../services/card/cardInspirationStorage";

type MainScreenProps = {
  isActive: boolean;
  refreshRevision: number;
  incomingCardDraft?: { id: number; draft: CardDraft } | null;
  onIncomingCardDraftHandled?: (id: number) => void;
  onOpenCard: (recordId: string, initialTab?: CardDetailRequest["initialTab"], origin?: CardDetailRequest["origin"]) => void;
  onOpenRecall: (mode?: "today" | "yesterday" | "recent" | "blind") => void;
  onOpenMemoryRound: () => void;
  memoryRoundResumeAvailable: boolean;
  onOpenAssistant: () => void;
  onOpenAccount: () => void;
};

type LibraryView = "all" | string;
type RecordActionAnchor = { x: number; y: number; width: number; height: number };

const UNCLASSIFIED_VIEW = "unclassified";
const TRASH_VIEW = "trash";
const EMPTY_DRAFT: CardDraft = { collectionId: null, title: "", text: "", rewrittenText: "", translationText: "", replyText: "", derivedFromText: "", clientId: null, recordId: null, submitted: false, clozeRanges: [], enabledLayers: { expression: true, translation: false, reply: false }, images: [] };
const LIBRARY_PAGE_SIZE = 40;
const BACKGROUND_REFRESH_INTERVAL_MS = 60_000;
const TOPIC_REFRESH_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000] as const;

const THUMBNAIL_REFRESH_LEAD_MS = 60_000;
const THUMBNAIL_ERROR_REFRESH_COOLDOWN_MS = 10_000;

export function MainScreen({ isActive, refreshRevision, incomingCardDraft, onIncomingCardDraftHandled, onOpenCard, onOpenRecall, onOpenMemoryRound, memoryRoundResumeAvailable, onOpenAssistant, onOpenAccount }: MainScreenProps) {
  const screenInsets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const appLocale = getLanguage();
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
  const [quickNoteCreating, setQuickNoteCreating] = useState(false);
  const [inspirationQuestions, setInspirationQuestions] = useState(() => fallbackCardInspirations().questions);
  const [inspirationIndex, setInspirationIndex] = useState(0);
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
  const quickNoteInputRef = useRef<TextInput>(null);
  const quickNoteGenerationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingDraftTabRef = useRef<CardDetailRequest["initialTab"]>("review");
  const sidebarActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const lastThumbnailErrorRefreshAtRef = useRef(0);
  const inspirationsLoadedRef = useRef(false);
  const inspirationsLocaleRef = useRef(appLocale);
  const topicRefreshTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const topicRefreshAttemptsRef = useRef(new Map<string, number>());
  const previousActiveRef = useRef(false);
  const observedRevisionRef = useRef(refreshRevision);
  const observedLibraryViewRef = useRef<LibraryView>(libraryView);
  const observedSortModeRef = useRef(sortMode);
  const quickNoteStt = useRealtimeSttInput({
    value: draft.text,
    onChangeText: (value) => void updateDraftText(value),
    disabled: quickNoteCreating || composerVisible,
    languageCode: appLocale,
  });
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
    if (!isActive) return;
    let active = true;
    void (async () => {
      const session = await getSession().catch(() => null);
      if (!active) return;
      const cached = session?.user.id
        ? await getCachedEntitlementForUser(session.user.id).catch(() => null)
        : null;
      if (!active) return;
      if (cached) setSidebarEntitlement(cached.data);

      const entitlement = await getCurrentEntitlement().catch(() => null);
      if (!active || !entitlement) return;
      setSidebarEntitlement(entitlement);
      await setCachedEntitlement(entitlement).catch(() => undefined);
    })();
    return () => { active = false; };
  }, [isActive, refreshRevision]);
  useEffect(() => {
    let active = true;
    void getCardCapabilities()
      .then((value) => { if (active) setCardCapabilities(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (inspirationsLocaleRef.current !== appLocale) {
      inspirationsLocaleRef.current = appLocale;
      inspirationsLoadedRef.current = false;
      setInspirationQuestions(fallbackCardInspirations().questions);
      setInspirationIndex(0);
    }
    if (!isActive || inspirationsLoadedRef.current) return;
    inspirationsLoadedRef.current = true;
    let active = true;
    void loadCardInspirations(appLocale).then(async (cached) => {
      if (!active) return;
      if (cached?.questions.length) {
        setInspirationQuestions(cached.questions);
        setInspirationIndex(0);
        return;
      }
      try {
        const generated = await getCardInspirations(appLocale);
        if (!active || !generated.questions.length) return;
        setInspirationQuestions(generated.questions);
        setInspirationIndex(0);
        await saveCardInspirations(generated, appLocale).catch(() => undefined);
      } catch {
        // Local starter questions keep this optional feature instant and usable.
      }
    });
    return () => { active = false; };
  }, [appLocale, isActive, refreshRevision]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    loadMoreSequenceRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoading(true);
    try {
      const collectionId = libraryView === "all" || libraryView === UNCLASSIFIED_VIEW || libraryView === TRASH_VIEW ? undefined : libraryView;
      const [rows, collectionResult] = await Promise.all([
        libraryView === TRASH_VIEW ? getCardTrash().then((items) => ({ items, nextCursor: null })) : getCardRecordPage({
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
      if (libraryView !== "all" && libraryView !== UNCLASSIFIED_VIEW && libraryView !== TRASH_VIEW && !collectionResult.collections.some((collection) => collection.id === libraryView)) {
        setLibraryView("all");
      }
    } catch {
      if (sequence !== refreshSequenceRef.current) return;
      Alert.alert(t("main.error.load_title"), t("main.error.network_retry"));
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
    const startedFromEmptyQuickNote = !composerVisible && !current.text && Boolean(text);
    const next: CardDraft = {
      ...current,
      ...(startedFromEmptyQuickNote && libraryView !== "all" && libraryView !== UNCLASSIFIED_VIEW
        ? { collectionId: libraryView }
        : {}),
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
    if (quickNoteStt.status !== "idle") void quickNoteStt.toggle();
    const hasDraftContent = Boolean(draft.title.trim() || draft.text.trim() || draft.rewrittenText.trim() || draft.translationText.trim() || draft.replyText.trim() || draft.images.length);
    if (!hasDraftContent) {
      void commitDraft({ ...draftRef.current, collectionId: null });
    }
    setComposerVisible(true);
  }

  function enqueueQuickNoteGeneration(
    created: CardRecordSummary,
    snapshot: CardDraft,
    selectedTargets: CardGenerationTarget[],
  ): void {
    quickNoteGenerationQueueRef.current = quickNoteGenerationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          let detail = await updateCardContent(created.id, {
            title: snapshot.title.trim() || null,
            originalText: snapshot.text.trim(),
            collectionId: snapshot.collectionId,
            ...(!snapshot.enabledLayers.expression ? { rewrittenText: null } : {}),
            translationText: null,
            ...(!snapshot.enabledLayers.reply ? { replyText: null } : {}),
          });
          const generation = await generateMissingCardContent(detail, selectedTargets);
          detail = generation.detail;
          if (detail.rewrittenText?.trim() && !detail.auxiliarySegments?.length) {
            try {
              detail = await generateCardContent(created.id, "auxiliary");
            } catch (error) {
              console.warn("[card] generate quick note auxiliary text failed", error);
            }
          }
          await setCardGenerationState(created.id, generation.failedTargets.length
            ? { pendingTargets: [], failedTargets: generation.failedTargets }
            : null);
          setRecords((current) => current.map((row) => row.id === created.id ? { ...detail, status: "completed" } : row));
          if (!generation.failedTargets.length) {
            if (!detail.title && !detail.topic) refreshGeneratedTopic(created.id);
            try {
              await saveDraftClozeRanges(created.id, snapshot.clozeRanges);
            } catch (error) {
              console.warn("[card] save quick note cloze failed", error);
            }
          }
        } catch (error) {
          console.warn("[card] quick note generation failed", error);
          await setCardGenerationState(created.id, { pendingTargets: [], failedTargets: selectedTargets });
          try {
            const saved = await getCardRecord(created.id);
            setRecords((current) => current.map((row) => row.id === created.id ? { ...saved, status: "completed" } : row));
          } catch {
            // The persisted generation state makes the card retryable after refresh.
          }
        } finally {
          snapshot.images.forEach((image) => removePersistentDraftImage(image.localUri));
        }
      });
  }

  async function sendQuickNote(): Promise<void> {
    if (submitInFlightRef.current) return;
    if (quickNoteStt.status !== "idle") await quickNoteStt.toggle();
    const snapshot = draftRef.current;
    const text = snapshot.text.trim();
    const count = countGraphemes(text);
    if (count < 1 || count > cardLimits.contentChars) {
      Alert.alert(t("card_detail.error.cannot_save"), t("card_detail.error.length_message"));
      return;
    }
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
    submitInFlightRef.current = true;
    setQuickNoteCreating(true);
    const clientId = snapshot.clientId ?? Crypto.randomUUID();
    const submitting = { ...snapshot, clientId, submitted: false };
    let persistedRecordId = snapshot.recordId;
    try {
      await commitDraft(submitting);
      const derivedContentMatchesSource = snapshot.derivedFromText === snapshot.text;
      const existingContent = {
        expression: derivedContentMatchesSource && snapshot.enabledLayers.expression ? snapshot.rewrittenText.trim() : "",
        reply: derivedContentMatchesSource && snapshot.enabledLayers.reply ? snapshot.replyText.trim() : "",
      };
      let created = snapshot.recordId
        ? await getCardRecord(snapshot.recordId)
        : await createCardEntry({
            clientId,
            collectionId: snapshot.collectionId,
            title: snapshot.title.trim() || null,
            originalText: text,
            rewrittenText: existingContent.expression || null,
            translationText: null,
            replyText: existingContent.reply || null,
            generateRewrite: false,
            imageUploadIds: snapshot.images.map((image) => image.uploadId).filter((uploadId): uploadId is string => Boolean(uploadId)),
          });
      const firstDraftImage = snapshot.images[0];
      if (firstDraftImage?.uploadId && ((firstDraftImage.focusX ?? 0.5) !== 0.5 || (firstDraftImage.focusY ?? 0.5) !== 0.5)) {
        const createdDetail = await getCardRecord(created.id);
        const coverImageId = createdDetail.images?.[0]?.id;
        if (coverImageId) created = await updateCardCoverPosition(created.id, coverImageId, firstDraftImage.focusX ?? 0.5, firstDraftImage.focusY ?? 0.5);
      }
      persistedRecordId = created.id;
      const selectedTargets: CardGenerationTarget[] = (["expression", "reply"] as const)
        .filter((target) => snapshot.enabledLayers[target]);
      await commitDraft({ ...submitting, recordId: persistedRecordId });
      await setCardGenerationState(created.id, { pendingTargets: selectedTargets, failedTargets: [] });
      const optimisticRecord: CardRecordSummary = {
        ...created,
        status: "processing",
        ...(firstDraftImage && !created.thumbnail ? {
          thumbnail: { url: firstDraftImage.localUri, width: firstDraftImage.width, height: firstDraftImage.height },
        } : {}),
      };
      if (libraryView === "all" || (libraryView === UNCLASSIFIED_VIEW && created.collectionId === null) || created.collectionId === libraryView) {
        setRecords((current) => sortMode === "oldest"
          ? [...current.filter((row) => row.id !== created.id), optimisticRecord]
          : [optimisticRecord, ...current.filter((row) => row.id !== created.id)]);
      } else {
        setLibraryView("all");
      }
      await commitDraft(EMPTY_DRAFT);
      setInspirationIndex((current) => inspirationQuestions.length ? (current + 1) % inspirationQuestions.length : 0);
      enqueueQuickNoteGeneration(created, snapshot, selectedTargets);
      onOpenCard(created.id);
    } catch (error) {
      console.warn("[card] quick note create failed", error);
      const retryable = {
        ...submitting,
        recordId: persistedRecordId,
        clientId: error instanceof CardApiError && error.code === "CARD_CLIENT_ID_CONSUMED" ? null : submitting.clientId,
        submitted: false,
      };
      await commitDraft(retryable);
      if (error instanceof CardApiError && error.code === "TOKEN_QUOTA_EXCEEDED") return;
      Alert.alert(t("card_detail.error.send"), t("card_detail.draft_retained"));
    } finally {
      submitInFlightRef.current = false;
      setQuickNoteCreating(false);
    }
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
      Alert.alert(t("main.error.try_later"), t("main.error.card_processing"));
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
    const selectedTargets: CardGenerationTarget[] = (["expression", "reply"] as const)
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
            translationText: null,
            replyText: existingContent.reply || null,
            generateRewrite: false,
            imageUploadIds: snapshot.images.map((image) => image.uploadId).filter((uploadId): uploadId is string => Boolean(uploadId)),
          });
      const firstDraftImage = snapshot.images[0];
      if (firstDraftImage?.uploadId && ((firstDraftImage.focusX ?? 0.5) !== 0.5 || (firstDraftImage.focusY ?? 0.5) !== 0.5)) {
        const createdDetail = await getCardRecord(created.id);
        const coverImageId = createdDetail.images?.[0]?.id;
        if (coverImageId) {
          created = await updateCardCoverPosition(created.id, coverImageId, firstDraftImage.focusX ?? 0.5, firstDraftImage.focusY ?? 0.5);
        }
      }
      persistedRecordId = created.id;
      await commitDraft({ ...submitting, recordId: persistedRecordId });

      await setCardGenerationState(created.id, { pendingTargets: selectedTargets, failedTargets: [] });
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
        translationText: null,
        ...(!snapshot.enabledLayers.reply ? { replyText: null } : {}),
      });
      const generation = await generateMissingCardContent(detail, selectedTargets);
      detail = generation.detail;
      if (detail.rewrittenText?.trim() && !detail.auxiliarySegments?.length) {
        try {
          detail = await generateCardContent(detail.id, "auxiliary");
        } catch (error) {
          console.warn("[card] generate converted auxiliary text failed", error);
        }
      }
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
        return;
      }
      if (isCardResourceLimitedError(error)) {
        Alert.alert(t("main.error.try_later"), t("main.error.card_processing"));
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
        ? current.images.map((candidate) => candidate.localUri === image.localUri ? { ...image, focusX: candidate.focusX ?? image.focusX, focusY: candidate.focusY ?? image.focusY } : candidate)
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
        return;
      } else if (error instanceof CardImageModerationRejectedError) {
        Alert.alert(t("card_detail.photo.add_failed_title"), t("card_detail.photo.moderation_rejected_message"));
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
      Alert.alert(t("card_detail.processing"), t("main.card.processing_message"));
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
        Alert.alert(t("main.search.failed"), t("main.error.network_retry"));
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
    if (libraryView === TRASH_VIEW) {
      Alert.alert("彻底删除这张卡片？", "删除后无法恢复。", [{ text: t("common.cancel"), style: "cancel" }, { text: "彻底删除", style: "destructive", onPress: () => void permanentlyDeleteCardRecord(recordId).then(() => setRecords((rows) => rows.filter((row) => row.id !== recordId))).catch(() => Alert.alert(t("main.error.delete_failed"))) }]);
      return;
    }
    Alert.alert("移入回收站？", "卡片将在回收站保留 30 天，期间可以随时恢复，也可以在回收站中彻底删除。", [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void deleteCardRecord(recordId).then(() => {
          setRecords((rows) => rows.filter((row) => row.id !== recordId));
        }).catch(() => Alert.alert(t("main.error.delete_failed"), t("card_detail.error.try_again"))),
      },
    ]);
  }

  function openRecordActions(record: CardRecordSummary, anchor: RecordActionAnchor): void {
    setRecordActionMenu({ record, anchor });
  }

  function restoreFromTrash(recordId: string): void {
    void restoreCardRecord(recordId).then(() => setRecords((rows) => rows.filter((row) => row.id !== recordId))).catch(() => Alert.alert("恢复失败", t("card_detail.error.try_again")));
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

  async function createDraftCollection(name: string, parentId: string | null): Promise<CardCollection> {
    const created = await createCardCollection(name, parentId);
    setCollections((current) => [...current, created]);
    return created;
  }

  async function renameDraftCollection(collectionId: string, name: string): Promise<void> {
    const updated = await renameCardCollection(collectionId, name);
    setCollections((current) => current.map((collection) => collection.id === collectionId ? updated : collection));
  }

  async function deleteDraftCollection(collection: CardCollection): Promise<void> {
    const removedIds = collectionDescendantIds(collection.id, collections);
    removedIds.add(collection.id);
    await deleteCardCollection(collection.id);
    setCollections((current) => current.filter((candidate) => !removedIds.has(candidate.id)));
    setRecords((current) => current.map((record) => record.collectionId && removedIds.has(record.collectionId) ? { ...record, collectionId: null } : record));
    if (draftRef.current.collectionId && removedIds.has(draftRef.current.collectionId)) {
      await updateDraftCollection(null);
    }
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
        : libraryView === TRASH_VIEW ? "回收站"
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
    const deletingPermanently = libraryView === TRASH_VIEW;
    const count = selectedRecordIds.size;
    Alert.alert(
      deletingPermanently ? `彻底删除 ${count} 张卡片？` : tf("library.delete_selected_title", { count }),
      deletingPermanently ? "删除后无法恢复。" : t("library.delete_selected_message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: deletingPermanently ? "彻底删除" : t("common.delete"), style: "destructive", onPress: () => void (async () => {
        const ids = [...selectedRecordIds];
        try {
          await Promise.all(ids.map((id) => deletingPermanently ? permanentlyDeleteCardRecord(id) : deleteCardRecord(id)));
          const deletedIds = new Set(ids);
          setRecords((current) => current.filter((record) => !deletedIds.has(record.id)));
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

  const assistantAvailable = sidebarEntitlement?.tier === "plus" || sidebarEntitlement?.tier === "pro";
  const openAssistant = async () => {
    if (assistantAvailable) {
      onOpenAssistant();
      return;
    }
    const entitlement = await getCurrentEntitlement().catch(() => null);
    if (entitlement) {
      setSidebarEntitlement(entitlement);
      await setCachedEntitlement(entitlement).catch(() => undefined);
    }
    if (entitlement?.tier === "plus" || entitlement?.tier === "pro") {
      onOpenAssistant();
      return;
    }
    Alert.alert(t("sidebar.assistant_members_only_title"), t("sidebar.assistant_members_only_message"));
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
          {selectingRecords ? <View style={styles.headerIconButton} /> : <Pressable
            accessibilityLabel={t("quick_note.a11y.search")}
            style={styles.headerIconButton}
            onPress={() => {
              setSearchCollectionId(undefined);
              setSearchVisible(true);
            }}
          >
            <Ionicons name="search-outline" size={23} color={theme.colors.text} />
          </Pressable>}
        </View>
      </View>

      <View style={styles.recallShortcuts}><Pressable style={styles.recallShortcut} onPress={() => onOpenRecall("recent")}><Text style={styles.recallShortcutTitle}>{t("recall.recent_shortcut")}</Text></Pressable><Pressable style={styles.recallShortcut} onPress={() => onOpenRecall("blind")}><Text style={styles.recallShortcutTitle}>{t("recall.blind_box")}</Text></Pressable><MemoryRoundShortcut active={isActive} resume={memoryRoundResumeAvailable} onPress={onOpenMemoryRound} /></View>

      <FlatList
        style={styles.libraryList}
        data={records}
        keyExtractor={(record) => record.id}
        renderItem={({ item: record }) => (
          <CardCard record={record} collectionName={record.collectionId ? collections.find((collection) => collection.id === record.collectionId)?.name : undefined} selecting={selectingRecords} selected={selectedRecordIds.has(record.id)} onPress={(origin) => selectingRecords ? toggleRecordSelection(record.id) : libraryView === TRASH_VIEW ? undefined : void openDetail(record, origin)} onOpenActions={(anchor) => openRecordActions(record, anchor)} onThumbnailError={recoverFailedThumbnail} />
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
            {libraryView !== TRASH_VIEW ? <Pressable style={styles.emptyAction} onPress={openCardComposer}>
              <Text style={styles.emptyActionText}>{t("quick_note.first_card")}</Text>
            </Pressable> : <Text style={styles.emptyText}>回收站是空的</Text>}
          </View>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loadMoreIndicator} /> : null}
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
          {libraryView === TRASH_VIEW ? <><Pressable style={styles.recordActionItem} onPress={() => { const id = recordActionMenu.record.id; setRecordActionMenu(null); restoreFromTrash(id); }}><Ionicons name="arrow-undo-outline" size={16} color={theme.colors.textSecondary} /><Text style={styles.recordActionText}>恢复</Text></Pressable><View style={styles.recordActionDivider} /></> : recordActionMenu.record.source === "card" ? <>
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
      {!selectingRecords && libraryView !== TRASH_VIEW ? <KeyboardStickyView offset={{ opened: screenInsets.bottom }} style={[styles.unifiedComposerDock, { bottom: Math.max(screenInsets.bottom + 10, 14) }]}>
        {!draft.text.trim() && inspirationQuestions[inspirationIndex] ? <View style={styles.inspirationCard}>
          <Pressable accessibilityLabel={inspirationQuestions[inspirationIndex]} style={styles.inspirationPrompt} onPress={() => quickNoteInputRef.current?.focus()}>
            <View style={styles.inspirationCopy}>
              <Text style={styles.inspirationName}>{t("quick_note.inspiration.name")}</Text>
              <Text numberOfLines={2} style={styles.inspirationQuestion}>{inspirationQuestions[inspirationIndex]}</Text>
            </View>
          </Pressable>
          <View style={styles.inspirationActions}>
            <Pressable accessibilityLabel={t("quick_note.inspiration.another")} hitSlop={6} style={styles.inspirationAction} onPress={() => setInspirationIndex((current) => (current + 1) % inspirationQuestions.length)}>
              <Ionicons name="refresh-outline" size={15} color={theme.colors.textSecondary} />
              <Text style={styles.inspirationActionText}>{t("quick_note.inspiration.another")}</Text>
            </Pressable>
            <Pressable accessibilityLabel={t("quick_note.inspiration.chat")} hitSlop={6} style={styles.inspirationAssistant} onPress={() => void openAssistant()}>
              <OioCharacter width={24} height={23} />
            </Pressable>
          </View>
        </View> : null}
        <View style={styles.unifiedComposerBar}>
          <View style={styles.unifiedComposerInput}>
            <Pressable accessibilityLabel={t("quick_note.expand_editor")} disabled={quickNoteCreating} style={styles.unifiedComposerAdd} onPress={openCardComposer}><Ionicons name="create-outline" size={19} color={theme.colors.textSecondary} /></Pressable>
            <TextInput
              ref={quickNoteInputRef}
              accessibilityLabel={t("quick_note.placeholder")}
              style={styles.unifiedComposerTextInput}
              value={draft.text}
              onChangeText={quickNoteStt.onChangeText}
              onSelectionChange={({ nativeEvent }) => quickNoteStt.onSelectionChange(nativeEvent.selection)}
              onFocus={() => { if (quickNoteStt.status !== "idle") void quickNoteStt.toggle(); }}
              placeholder={t("quick_note.placeholder")}
              placeholderTextColor={theme.colors.textMuted}
              maxLength={cardLimits.contentChars}
              multiline
              scrollEnabled
              textAlignVertical="center"
              editable={!quickNoteCreating}
            />
            <RealtimeSttButton
              status={quickNoteStt.status}
              audioLevel={quickNoteStt.audioLevel}
              disabled={quickNoteCreating}
              iconSize={19}
              style={styles.unifiedComposerMic}
              onPress={() => {
                Keyboard.dismiss();
                quickNoteInputRef.current?.blur();
                if (quickNoteStt.status === "idle") {
                  const end = draftRef.current.text.length;
                  quickNoteStt.onSelectionChange({ start: end, end });
                }
                void quickNoteStt.toggle();
              }}
            />
          </View>
          {draft.text.trim() || quickNoteCreating ? <Pressable accessibilityLabel={t("quick_note.a11y.send")} disabled={quickNoteCreating} style={[styles.unifiedComposerSend, quickNoteCreating && styles.unifiedComposerSendDisabled]} onPress={() => void sendQuickNote()}>
            {quickNoteCreating ? <ActivityIndicator size="small" color={theme.colors.surface} /> : <Ionicons name="arrow-up" size={19} color={theme.colors.surface} />}
          </Pressable> : null}
        </View>
      </KeyboardStickyView> : null}
      {selectingRecords && selectedRecordIds.size ? <View style={[styles.batchActionBar, libraryView === TRASH_VIEW && styles.batchActionBarCentered, { paddingBottom: Math.max(screenInsets.bottom, 10) }]}>{libraryView !== TRASH_VIEW ? <Pressable style={styles.batchAction} onPress={() => setBatchMoveVisible(true)}><Ionicons name="folder-open-outline" size={22} color={theme.colors.text} /><Text style={styles.batchActionText}>{t("library.move")}</Text></Pressable> : null}<Pressable style={styles.batchAction} onPress={confirmBatchDelete}><Ionicons name="trash-outline" size={22} color={theme.colors.danger} /><Text style={[styles.batchActionText, { color: theme.colors.danger }]}>{libraryView === TRASH_VIEW ? "彻底删除" : t("common.delete")}</Text></Pressable></View> : null}
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
            onDraftCreateCollection={createDraftCollection}
            onDraftRenameCollection={renameDraftCollection}
            onDraftDeleteCollection={deleteDraftCollection}
            onDraftSave={(initialTab) => void submit(initialTab)}
            onDraftChooseImage={() => void pickImage("library")}
            onDraftTakePhoto={() => void pickImage("camera")}
            onDraftSelectImage={(asset) => applyDraftImage(asset)}
            onDraftRemoveImage={removeDraftImage}
            onDraftCoverPositionChange={(localUri, focusX, focusY) => updateCommittedDraft((current) => ({
              ...current,
              images: current.images.map((image) => image.localUri === localUri ? { ...image, focusX, focusY } : image),
            }))}
          />
        </Modal>
      ) : null}
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

function MemoryRoundShortcut({ active, resume, onPress }: { active: boolean; resume: boolean; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    let animation: Animated.CompositeAnimation | null = null;
    const startPulse = () => {
      animation?.stop();
      pulse.stopAnimation();
      pulse.setValue(0);
      animation = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      animation.start();
    };
    startPulse();
    const subscription = AppState.addEventListener("change", (state) => state === "active" ? startPulse() : animation?.stop());
    return () => {
      subscription.remove();
      animation?.stop();
      pulse.stopAnimation();
    };
  }, [active, pulse]);
  return <Pressable style={[styles.recallShortcut, styles.memoryRoundShortcut]} onPress={onPress}><Animated.View style={[styles.memoryRoundDot, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.62, 1] }) }]} /><Text style={[styles.recallShortcutTitle, styles.memoryRoundShortcutText]}>{t("memory_round.title")}</Text>{resume ? <Text style={styles.memoryRoundResumeText}>{t("common.continue")}</Text> : null}</Pressable>;
}

function LibrarySidebar({ visible, activeView, collections, profile, entitlement, onClose, onSelect, onOpenRecall, onOpenAssistant, onOpenCalendar, onCreateCollection, onRenameCollection, onToggleFavorite, onDeleteCollection, onReorderCollection, onReorderFavoriteCollection, onOpenAccount }: {
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
  onReorderCollection: (collectionId: string, parentId: string | null, position: number) => Promise<void>;
  onReorderFavoriteCollection: (collectionId: string, position: number) => Promise<void>;
  onOpenAccount: () => void;
}) {
  const assistantAvailable = entitlement?.tier === "plus" || entitlement?.tier === "pro";
  const insets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const sidebarCollectionContentWidth = Math.min(windowDimensions.width * 0.84, 360) - 20;
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [sidebarInlineCreating, setSidebarInlineCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [savingCollection, setSavingCollection] = useState(false);
  const [renamingCollectionId, setRenamingCollectionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [movingCollectionId, setMovingCollectionId] = useState<string | null>(null);
  const [movingCollectionSaving, setMovingCollectionSaving] = useState(false);
  const [managerExpandedCollectionIds, setManagerExpandedCollectionIds] = useState<Set<string>>(new Set());
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(new Set());
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);
  const [favoriteSavingId, setFavoriteSavingId] = useState<string | null>(null);
  const [reorderSavingId, setReorderSavingId] = useState<string | null>(null);
  const [orderedCollections, setOrderedCollections] = useState(collections);
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);
  const [collectionActionMenu, setCollectionActionMenu] = useState<{ collection: CardCollection; anchor: RecordActionAnchor } | null>(null);
  const collectionScrollRef = useAnimatedRef<React.ElementRef<typeof Reanimated.ScrollView>>();
  const collectionManagerScrollRef = useAnimatedRef<React.ElementRef<typeof Reanimated.ScrollView>>();
  const focusedCollectionInputHandleRef = useRef<object | null>(null);
  const collectionKeyExtractor = useCallback((collection: CardCollection) => collection.id, []);
  const favoriteCollections = useMemo(
    () => orderedCollections
      .filter((collection) => collection.isFavorite)
      .sort((left, right) => (left.favoriteSortOrder ?? Number.MAX_SAFE_INTEGER) - (right.favoriteSortOrder ?? Number.MAX_SAFE_INTEGER)),
    [orderedCollections],
  );
  const rootCollections = useMemo(
    () => orderedCollections.filter((collection) => collection.parentId === null),
    [orderedCollections],
  );
  const collectionManagerRows = useMemo(() => collectionTreeRows(orderedCollections), [orderedCollections]);
  const editingCollection = orderedCollections.find((collection) => collection.id === editingCollectionId) ?? null;
  const movingCollection = orderedCollections.find((collection) => collection.id === movingCollectionId) ?? null;
  const unavailableMoveTargetIds = useMemo(() => {
    if (!movingCollectionId) return new Set<string>();
    const unavailable = collectionDescendantIds(movingCollectionId, orderedCollections);
    unavailable.add(movingCollectionId);
    return unavailable;
  }, [movingCollectionId, orderedCollections]);
  const collectionMoveTargets = useMemo(
    () => collectionManagerRows.filter(({ collection }) => !unavailableMoveTargetIds.has(collection.id)),
    [collectionManagerRows, unavailableMoveTargetIds],
  );
  const managerInlineCreating = !sidebarInlineCreating && Boolean(editingCollectionId) && creatingParentId !== undefined && renamingCollectionId === null;
  const collectionNameEditing = (!sidebarInlineCreating && creatingParentId !== undefined && !managerInlineCreating) || renamingCollectionId !== null;
  const collectionManagerWidth = Math.max(280, windowDimensions.width - 32);
  useEffect(() => {
    if (!draggingCollectionId && !reorderSavingId) setOrderedCollections(collections);
  }, [collections, draggingCollectionId, reorderSavingId]);

  useEffect(() => {
    if (!visible) {
      setCollectionActionMenu(null);
      if (sidebarInlineCreating) {
        setSidebarInlineCreating(false);
        setCreatingParentId(undefined);
        setNewCollectionName("");
      }
    }
  }, [sidebarInlineCreating, visible]);

  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      const nativeHandle = focusedCollectionInputHandleRef.current;
      if (nativeHandle) scrollCollectionInputIntoView(nativeHandle);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!editingCollectionId || collectionNameEditing) return;
    const rowIndex = collectionManagerRows.findIndex((row) => row.collection.id === editingCollectionId);
    if (rowIndex < 0) return;
    const timer = setTimeout(() => {
      const inlineOffset = managerInlineCreating ? 58 : 0;
      collectionManagerScrollRef.current?.scrollTo({ y: Math.max(0, rowIndex * 52 + inlineOffset - 104), animated: managerInlineCreating });
    }, 260);
    return () => clearTimeout(timer);
  }, [collectionManagerRows, collectionNameEditing, creatingParentId, editingCollectionId, managerInlineCreating]);

  useEffect(() => {
    if (!editingCollectionId) return;
    setManagerExpandedCollectionIds((current) => {
      if (current.size) return current;
      return new Set(orderedCollections.filter((collection) => orderedCollections.some((candidate) => candidate.parentId === collection.id)).map((collection) => collection.id));
    });
  }, [editingCollectionId, orderedCollections]);

  function beginNativeCollectionDrag(collectionId: string | undefined): void {
    if (!collectionId) return;
    setDraggingCollectionId(collectionId);
  }

  async function commitNativeReorder(parentId: string | null, data: CardCollection[], from: number, to: number): Promise<void> {
    setDraggingCollectionId(null);
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
      Alert.alert(t("main.collection.reorder_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    } finally {
      setReorderSavingId(null);
    }
  }

  async function commitFavoriteReorder(data: CardCollection[], from: number, to: number): Promise<void> {
    setDraggingCollectionId(null);
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
      Alert.alert(t("main.collection.favorite_reorder_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
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
      Alert.alert(t("main.collection.favorite_update_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    } finally {
      setFavoriteSavingId(null);
    }
  }

  function confirmDeleteCollection(collection: CardCollection): void {
    Alert.alert(t("main.collection.delete_title"), t("main.collection.delete_message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => void onDeleteCollection(collection).catch(() => Alert.alert(t("main.error.delete_failed"), t("card_detail.error.try_again"))),
      },
    ]);
  }

  function runCollectionAction(collection: CardCollection, index: number): void {
    if (index === 0) beginSidebarCreating(collection.id);
    else if (index === 1) beginRenaming(collection);
    else if (index === 2) confirmDeleteCollection(collection);
  }

  function openCollectionActions(collection: CardCollection, anchor: RecordActionAnchor): void {
    setCollectionActionMenu({ collection, anchor });
  }

  function selectCollectionAction(index: number): void {
    const collection = collectionActionMenu?.collection;
    setCollectionActionMenu(null);
    if (collection) runCollectionAction(collection, index);
  }

  function collectionActionMenuPosition(): { top: number; right: number } {
    const anchor = collectionActionMenu?.anchor;
    const menuHeight = 131;
    const gap = 4;
    const safeTop = Math.max(insets.top, 8) + 8;
    const safeBottom = windowDimensions.height - Math.max(insets.bottom, 8) - 8;
    const anchorTop = anchor?.y ?? safeTop;
    const anchorBottom = anchorTop + (anchor?.height ?? 0);
    const preferredTop = anchorBottom + gap;
    return {
      top: Math.max(safeTop, Math.min(preferredTop, safeBottom - menuHeight)),
      // Keep the popover clear of the trailing ellipsis. A fixed sidebar-relative
      // offset also prevents it jumping while the sidebar is still sliding in.
      right: 48,
    };
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
      setSidebarInlineCreating(false);
    } catch (error) {
      Alert.alert(t("main.collection.create_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    } finally {
      setSavingCollection(false);
    }
  }

  function beginCreating(parentId: string | null): void {
    setSidebarInlineCreating(false);
    setRenamingCollectionId(null);
    setRenameValue("");
    setCreatingParentId(parentId);
    setNewCollectionName("");
    onClose();
  }

  function beginSidebarCreating(parentId: string | null): void {
    setCollectionActionMenu(null);
    setEditingCollectionId(null);
    setRenamingCollectionId(null);
    setRenameValue("");
    setCreatingParentId(parentId);
    setNewCollectionName("");
    setSidebarInlineCreating(true);
    if (parentId) {
      setExpandedCollectionIds((current) => new Set(current).add(parentId));
    }
  }

  function beginRenaming(collection: CardCollection): void {
    setSidebarInlineCreating(false);
    setCreatingParentId(undefined);
    setNewCollectionName("");
    setEditingCollectionId(collection.id);
    setRenamingCollectionId(null);
    setRenameValue(collection.name);
    onClose();
  }

  function startRenaming(collection: CardCollection): void {
    setSidebarInlineCreating(false);
    setEditingCollectionId(collection.id);
    setCreatingParentId(undefined);
    setNewCollectionName("");
    setRenamingCollectionId(collection.id);
    setRenameValue(collection.name);
  }

  function startCreatingChild(collection: CardCollection): void {
    setEditingCollectionId(collection.id);
    setManagerExpandedCollectionIds((current) => new Set(current).add(collection.id));
    beginCreating(collection.id);
  }

  function toggleManagerCollectionExpanded(collectionId: string): void {
    setManagerExpandedCollectionIds((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  }

  function startMovingCollection(collection: CardCollection): void {
    setEditingCollectionId(collection.id);
    setCreatingParentId(undefined);
    setNewCollectionName("");
    cancelRenaming();
    setMovingCollectionId(collection.id);
  }

  async function moveCollectionFromManager(parentId: string | null): Promise<void> {
    const moving = orderedCollections.find((collection) => collection.id === movingCollectionId);
    if (!moving || movingCollectionSaving) return;
    if (moving.parentId === parentId) {
      setMovingCollectionId(null);
      return;
    }
    const position = orderedCollections.filter((collection) => collection.parentId === parentId && collection.id !== moving.id).length;
    setMovingCollectionSaving(true);
    try {
      await onReorderCollection(moving.id, parentId, position);
      setMovingCollectionId(null);
    } catch (error) {
      Alert.alert(t("main.collection.move_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    } finally {
      setMovingCollectionSaving(false);
    }
  }

  function cancelRenaming(): void {
    setRenamingCollectionId(null);
    setRenameValue("");
  }

  function closeCollectionEditor(): void {
    setSidebarInlineCreating(false);
    setCreatingParentId(undefined);
    setNewCollectionName("");
    cancelRenaming();
    setEditingCollectionId(null);
    setMovingCollectionId(null);
  }

  async function submitRename(): Promise<void> {
    const name = renameValue.trim();
    if (!renamingCollectionId || !name || savingRename) return;
    setSavingRename(true);
    try {
      await onRenameCollection(renamingCollectionId, name);
      cancelRenaming();
    } catch (error) {
      Alert.alert(t("main.collection.rename_failed"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
    } finally {
      setSavingRename(false);
    }
  }

  function selectCollectionForEditing(collection: CardCollection): void {
    if (collection.id === editingCollectionId) return;
    setEditingCollectionId(collection.id);
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
    const scrollResponder = collectionScrollRef.current?.getScrollResponder() as {
      scrollResponderScrollNativeHandleToKeyboard?: (handle: object, extraOffset: number, preventNegativeScrollOffset: boolean) => void;
    } | undefined;
    scrollResponder?.scrollResponderScrollNativeHandleToKeyboard?.(nativeHandle, 18, true);
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
          placeholder={creatingParentId ? t("main.collection.child_name") : t("main.collection.name")}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={(event) => keepCollectionInputVisible(event.target)}
          onBlur={(event) => clearFocusedCollectionInput(event.target)}
          style={styles.sidebarCreateInput}
        />
        <Pressable accessibilityLabel={t("main.collection.a11y.finish_create")} disabled={!newCollectionName.trim() || savingCollection} hitSlop={8} onPress={() => void createCollection()}>
          {savingCollection
            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            : <Ionicons name="checkmark-outline" size={22} color={newCollectionName.trim() ? theme.colors.text : theme.colors.textMuted} />}
        </Pressable>
        <Pressable
          accessibilityLabel={t("sidebar.a11y.cancel_new_collection")}
          disabled={savingCollection}
          hitSlop={8}
          onPress={() => {
            setCreatingParentId(undefined);
            setNewCollectionName("");
            setSidebarInlineCreating(false);
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

  function renderCollectionNode(collection: CardCollection, depth: number): React.ReactNode {
    const children = orderedCollections.filter((candidate) => candidate.parentId === collection.id);
    const expanded = expandedCollectionIds.has(collection.id);
    const creatingChildHere = sidebarInlineCreating && creatingParentId === collection.id;
    return (
        <React.Fragment key={collection.id}>
          <SidebarRow
            label={collection.name}
            selected={activeView === collection.id}
            depth={depth}
            expandable={children.length > 0 || creatingChildHere}
            expanded={expanded}
            onToggle={() => toggleExpanded(collection.id)}
            favorite={collection.isFavorite}
            favoriteSaving={favoriteSavingId === collection.id}
            onToggleFavorite={() => void toggleFavorite(collection)}
            onMore={(anchor) => openCollectionActions(collection, anchor)}
            onPress={() => onSelect(collection.id)}
          />
          {expanded && creatingChildHere ? renderCreateRow(depth + 1) : null}
          {expanded ? renderCollectionTree(collection.id, depth + 1) : null}
        </React.Fragment>
    );
  }

  function renderCollectionManagerNode(collection: CardCollection, depth: number): React.ReactNode {
    const children = orderedCollections
      .filter((candidate) => candidate.parentId === collection.id)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
    const expanded = managerExpandedCollectionIds.has(collection.id);
    const inlineCreatingHere = managerInlineCreating && creatingParentId === collection.id;
    const expandable = children.length > 0 || inlineCreatingHere;
    return (
      <React.Fragment key={collection.id}>
        <View style={[
          styles.collectionManagerRow,
          editingCollectionId === collection.id && styles.collectionManagerRowSelected,
        ]}>
          <Pressable
            onPress={() => selectCollectionForEditing(collection)}
            style={[styles.collectionManagerRowContent, { paddingLeft: 14 + depth * 22 }]}
          >
            {expandable ? (
              <Pressable
                accessibilityLabel={expanded ? t("sidebar.a11y.collapse_collections") : t("sidebar.a11y.expand_collections")}
                hitSlop={6}
                style={styles.collectionManagerDisclosure}
                onPress={() => toggleManagerCollectionExpanded(collection.id)}
              >
                <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
              </Pressable>
            ) : <View style={styles.collectionManagerDisclosure} />}
            <Text numberOfLines={1} style={styles.collectionRowName}>{collection.name}</Text>
            {reorderSavingId === collection.id ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
            <Pressable accessibilityLabel={t("main.collection.new_child")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => startCreatingChild(collection)}>
              <Ionicons name="add-circle-outline" size={19} color={theme.colors.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={t("main.collection.rename")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => startRenaming(collection)}>
              <Ionicons name="create-outline" size={19} color={theme.colors.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={t("main.collection.move_to")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => startMovingCollection(collection)}>
              <Ionicons name="move-outline" size={19} color={theme.colors.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={t("common.delete")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => confirmDeleteCollection(collection)}>
              <Ionicons name="trash-outline" size={19} color={theme.colors.danger} />
            </Pressable>
          </Pressable>
        </View>
        {inlineCreatingHere ? (
          <View style={[styles.collectionManagerInlineCreate, { marginLeft: 14 + (depth + 1) * 22 }]}>
            <View style={styles.collectionManagerDisclosure} />
            <TextInput
              autoFocus
              value={newCollectionName}
              onChangeText={setNewCollectionName}
              onSubmitEditing={() => void createCollection()}
              editable={!savingCollection}
              maxLength={60}
              returnKeyType="done"
              placeholder={t("main.collection.child_name")}
              placeholderTextColor={theme.colors.textMuted}
              style={styles.collectionManagerInlineInput}
            />
            <Pressable disabled={!newCollectionName.trim() || savingCollection} hitSlop={7} style={styles.collectionManagerInlineAction} onPress={() => void createCollection()}>
              {savingCollection
                ? <ActivityIndicator size="small" color={theme.colors.accentStrong} />
                : <Ionicons name="checkmark-circle-outline" size={22} color={newCollectionName.trim() ? theme.colors.accentStrong : theme.colors.textMuted} />}
            </Pressable>
            <Pressable disabled={savingCollection} hitSlop={7} style={styles.collectionManagerInlineAction} onPress={() => { setCreatingParentId(undefined); setNewCollectionName(""); }}>
              <Ionicons name="close-outline" size={22} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        {expanded ? children.map((child) => renderCollectionManagerNode(child, depth + 1)) : null}
      </React.Fragment>
    );
  }

  return (
    <>
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
            <SidebarRow leading={<OioRecall width={27} height={25} />} label={t("sidebar.recall")} onPress={onOpenRecall} />
          </View>

          <View style={styles.sidebarCollectionSection}>
            <Reanimated.ScrollView
              ref={collectionScrollRef}
              style={styles.sidebarCollectionScroller}
              contentContainerStyle={styles.sidebarCollectionContent}
              nestedScrollEnabled
              alwaysBounceVertical={false}
              bounces={collections.length > 7}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
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
                    <Sortable.Flex
                      flexDirection="column"
                      flexWrap="nowrap"
                      width={sidebarCollectionContentWidth}
                      scrollableRef={collectionScrollRef}
                      dragActivationDelay={400}
                      itemsLayoutTransitionMode="reorder"
                      autoScrollEnabled
                      onDragStart={({ key }) => beginNativeCollectionDrag(key)}
                      onDragEnd={({ order, fromIndex, toIndex }) => {
                        void commitFavoriteReorder(order(favoriteCollections), fromIndex, toIndex);
                      }}
                    >
                      {favoriteCollections.map((item) => (
                        <View key={item.id} style={[styles.sidebarSortableCollection, { width: sidebarCollectionContentWidth }]}>
                          <SidebarRow label={item.name} selected={activeView === item.id} favorite favoriteSaving={favoriteSavingId === item.id} onToggleFavorite={() => void toggleFavorite(item)} onPress={() => onSelect(item.id)} />
                        </View>
                      ))}
                    </Sortable.Flex>
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
                        accessibilityLabel={t("sidebar.a11y.new_collection")}
                        style={styles.sidebarSectionAction}
                        hitSlop={8}
                        onPress={() => { setCollectionsExpanded(true); beginSidebarCreating(null); }}
                      >
                        <Ionicons name="add-outline" size={23} color={theme.colors.text} />
                      </Pressable>
                    </View>
                  </View>
                  {collectionsExpanded ? (
                    <>
                      {sidebarInlineCreating && creatingParentId === null ? renderCreateRow(0) : null}
                      <SidebarRow label={t("sidebar.unclassified")} selected={activeView === UNCLASSIFIED_VIEW} depth={0} onPress={() => onSelect(UNCLASSIFIED_VIEW)} />
                      <Sortable.Flex
                        flexDirection="column"
                        flexWrap="nowrap"
                        width={sidebarCollectionContentWidth}
                        scrollableRef={collectionScrollRef}
                        dragActivationDelay={400}
                        itemsLayoutTransitionMode="reorder"
                        autoScrollEnabled
                        onDragStart={({ key }) => beginNativeCollectionDrag(key)}
                        onDragEnd={({ order, fromIndex, toIndex }) => {
                          void commitNativeReorder(null, order(rootCollections), fromIndex, toIndex);
                        }}
                      >
                        {rootCollections.map((item) => (
                          <View key={item.id} style={[styles.sidebarSortableCollection, { width: sidebarCollectionContentWidth }]}>
                            {renderCollectionNode(item, 0)}
                          </View>
                        ))}
                      </Sortable.Flex>
                    </>
                  ) : null}
                  <SidebarRow icon="trash-outline" label="回收站" selected={activeView === TRASH_VIEW} depth={0} onPress={() => onSelect(TRASH_VIEW)} />
            </Reanimated.ScrollView>
          </View>
          {collectionActionMenu ? (
            <Pressable style={styles.collectionActionBackdrop} onPress={() => setCollectionActionMenu(null)}>
              <Pressable
                style={[styles.collectionActionMenu, collectionActionMenuPosition()]}
                onPress={(event) => event.stopPropagation()}
              >
                {[
                  ["add-circle-outline", t("main.collection.add")],
                  ["create-outline", t("main.collection.edit")],
                ].map(([icon, label], index) => (
                  <Pressable key={label} style={styles.collectionActionRow} onPress={() => selectCollectionAction(index)}>
                    <Ionicons name={icon as React.ComponentProps<typeof Ionicons>["name"]} size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.collectionActionText}>{label}</Text>
                  </Pressable>
                ))}
                <View style={styles.collectionActionDivider} />
                <Pressable style={styles.collectionActionRow} onPress={() => selectCollectionAction(2)}>
                  <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                  <Text style={[styles.collectionActionText, styles.collectionActionDanger]}>{t("common.delete")}</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          ) : null}
        </KeyboardAvoidingView>
    </AnimatedSidebarModal>
    <Modal
      visible={Boolean(editingCollectionId) || collectionNameEditing}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (savingCollection || savingRename || reorderSavingId || movingCollectionSaving) return;
        closeCollectionEditor();
      }}
    >
      <SafeAreaView style={styles.modalPage}>
        <KeyboardAvoidingView behavior="padding" style={styles.collectionNameSheet}>
          <View style={styles.modalHeader}>
            <Pressable
              style={styles.modalHeaderButton}
              disabled={savingCollection || savingRename || Boolean(reorderSavingId)}
              onPress={() => {
                if (movingCollectionId) {
                  setMovingCollectionId(null);
                } else if (collectionNameEditing && editingCollectionId) {
                  setCreatingParentId(undefined);
                  setNewCollectionName("");
                  cancelRenaming();
                } else {
                  closeCollectionEditor();
                }
              }}
            >
              <Text style={styles.modalCancel}>{t("common.cancel")}</Text>
            </Pressable>
            <Text style={styles.modalTitle}>
              {renamingCollectionId
                ? t("main.collection.rename")
                : movingCollection
                  ? tf("main.collection.move_named", { name: movingCollection.name })
                : creatingParentId && !managerInlineCreating
                  ? t("main.collection.new_child")
                  : editingCollectionId
                    ? t("main.collection.manage")
                    : t("sidebar.a11y.new_collection")}
            </Text>
            {movingCollectionId ? <View style={styles.modalHeaderButton} /> : <Pressable
              style={styles.modalHeaderButton}
              disabled={Boolean(reorderSavingId) || (collectionNameEditing && (renamingCollectionId ? !renameValue.trim() || savingRename : !newCollectionName.trim() || savingCollection))}
              onPress={() => collectionNameEditing
                ? renamingCollectionId ? void submitRename() : void createCollection()
                : closeCollectionEditor()}
            >
              {savingCollection || savingRename
                ? <ActivityIndicator size="small" color={theme.colors.accentStrong} />
                : <Text style={[
                    styles.collectionNameSheetConfirm,
                    collectionNameEditing && (renamingCollectionId ? !renameValue.trim() : !newCollectionName.trim()) && styles.collectionNameSheetConfirmDisabled,
                  ]}>{collectionNameEditing ? renamingCollectionId ? t("common.save") : t("common.confirm") : t("main.collection.done")}</Text>}
            </Pressable>}
          </View>
          <Reanimated.ScrollView
            ref={collectionManagerScrollRef}
            contentContainerStyle={styles.collectionNameSheetBody}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {collectionNameEditing ? (
              <View style={styles.collectionNameEditorCard}>
                {creatingParentId ? <Text style={styles.collectionNameSheetContext}>{collections.find((collection) => collection.id === creatingParentId)?.name ?? ""}</Text> : null}
                <TextInput
                  autoFocus
                  value={renamingCollectionId ? renameValue : newCollectionName}
                  onChangeText={renamingCollectionId ? setRenameValue : setNewCollectionName}
                  onSubmitEditing={() => renamingCollectionId ? void submitRename() : void createCollection()}
                  editable={!savingCollection && !savingRename}
                  maxLength={60}
                  returnKeyType="done"
                  selectTextOnFocus={Boolean(renamingCollectionId)}
                  placeholder={creatingParentId ? t("main.collection.child_name") : t("main.collection.name")}
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.collectionNameSheetInput}
                />
              </View>
            ) : null}
            {movingCollection ? (
              <View style={styles.collectionManagerMoveList}>
                <Pressable style={styles.collectionManagerMoveRow} disabled={movingCollectionSaving} onPress={() => void moveCollectionFromManager(null)}>
                  <Ionicons name="albums-outline" size={20} color={theme.colors.textSecondary} />
                  <Text style={styles.collectionRowName}>{t("main.collection.top_level")}</Text>
                  {movingCollection.parentId === null ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                </Pressable>
                {collectionMoveTargets.map(({ collection, depth }) => (
                  <Pressable
                    key={collection.id}
                    style={[styles.collectionManagerMoveRow, { paddingLeft: 14 + depth * 22 }]}
                    disabled={movingCollectionSaving}
                    onPress={() => void moveCollectionFromManager(collection.id)}
                  >
                    <Ionicons name="folder-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.collectionRowName}>{collection.name}</Text>
                    {movingCollection.parentId === collection.id ? <Ionicons name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                  </Pressable>
                ))}
                {movingCollectionSaving ? <ActivityIndicator style={styles.collectionManagerMoveSaving} color={theme.colors.accentStrong} /> : null}
              </View>
            ) : !collectionNameEditing ? (
              <Sortable.Flex
                flexDirection="column"
                flexWrap="nowrap"
                width={collectionManagerWidth}
                scrollableRef={collectionManagerScrollRef}
                dragActivationDelay={400}
                itemsLayoutTransitionMode="reorder"
                autoScrollEnabled
                sortEnabled={!managerInlineCreating && !reorderSavingId && !savingCollection && !savingRename}
                onDragStart={({ key }) => {
                  setDraggingCollectionId(key);
                  Keyboard.dismiss();
                }}
                onDragEnd={({ order, fromIndex, toIndex }) => {
                  void commitNativeReorder(null, order(rootCollections), fromIndex, toIndex);
                }}
              >
                {rootCollections.map((collection) => (
                  <View key={collection.id} style={[styles.collectionManagerSortableRow, { width: collectionManagerWidth }]}>
                    {renderCollectionManagerNode(collection, 0)}
                  </View>
                ))}
              </Sortable.Flex>
            ) : null}
          </Reanimated.ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
    </>
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

function SidebarRow({ icon, leading, label, count, selected = false, muted = false, onPress, depth = 0, expandable = false, expanded = false, onToggle, favorite, favoriteSaving = false, onToggleFavorite, onMore }: {
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
  onMore?: (anchor: RecordActionAnchor) => void;
}) {
  const moreButtonRef = useRef<View>(null);
  return (
    <Pressable
      style={[styles.sidebarRow, muted && styles.sidebarRowMuted, { paddingLeft: 14 + Math.min(depth, 2) * 18 }, selected && styles.sidebarRowSelected]}
      onPress={onPress}
    >
      {selected ? <View pointerEvents="none" style={styles.sidebarSelectionMark} /> : null}
      <Pressable accessibilityLabel={expanded ? t("sidebar.a11y.collapse_collection") : t("sidebar.a11y.expand_collection")} disabled={!expandable} style={styles.sidebarDisclosure} onPress={(event) => { event.stopPropagation(); onToggle?.(); }}>
        {expandable ? <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} /> : null}
      </Pressable>
      {icon ? <Ionicons name={icon} size={19} color={muted ? theme.colors.textMuted : selected ? "#111111" : "#555555"} /> : null}
      {leading ? <View style={muted && styles.sidebarLeadingMuted}>{leading}</View> : null}
      <Text numberOfLines={1} style={[styles.sidebarRowLabel, muted && styles.sidebarRowLabelMuted, selected && styles.sidebarRowLabelSelected]}>{label}</Text>
      {count !== undefined ? <Text style={styles.sidebarRowCount}>{count}</Text> : null}
      {onToggleFavorite ? (
        <Pressable
          accessibilityLabel={favorite ? tf("sidebar.a11y.unfavorite", { label }) : tf("sidebar.a11y.favorite", { label })}
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
          ref={moreButtonRef}
          collapsable={false}
          accessibilityLabel={tf("sidebar.a11y.more_actions", { label })}
          style={styles.sidebarRowAction}
          hitSlop={6}
          onPress={(event) => {
            event.stopPropagation();
            const { pageX, pageY } = event.nativeEvent;
            onMore({ x: pageX, y: pageY, width: 0, height: 0 });
            moreButtonRef.current?.measureInWindow((x, y, width, height) => {
              if (width > 0 && height > 0) onMore({ x, y, width, height });
            });
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
  const collectionLabel = collectionId === undefined ? t("sidebar.collections") : collectionId === null ? t("sidebar.unclassified") : selectedCollection ? collectionPathName(selectedCollection, collections) : t("main.search.category");
  return <SafeAreaView style={styles.searchPage}>
    <View style={styles.searchPageHeader}>
      <Pressable accessibilityLabel={t("card_detail.back")} style={styles.searchBackButton} onPress={onClose}><Ionicons name="chevron-back" size={25} color={theme.colors.text} /></Pressable>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={theme.colors.textMuted} />
        <TextInput ref={inputRef} value={query} onChangeText={onQueryChange} onSubmitEditing={onSearch} returnKeyType="search" style={styles.searchPageInput} />
        {query ? <Pressable accessibilityLabel={t("main.search.clear")} hitSlop={8} onPress={() => onQueryChange("")}><Ionicons name="close-circle" size={19} color={theme.colors.textMuted} /></Pressable> : null}
      </View>
      <Pressable accessibilityLabel={t("main.search.action")} disabled={!query.trim() || searching} style={[styles.searchPageSubmit, (!query.trim() || searching) && styles.searchPageSubmitDisabled]} onPress={onSearch}>
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
      {results ? <Text style={styles.searchSummary}>{results.length ? tf("main.search.result_count", { count: results.length }) : tf("main.search.no_result", { query: query.trim() })}</Text> : <View style={styles.searchStart}><Ionicons name="search-outline" size={30} color="#C1C1C1" /><Text style={styles.searchStartText}>{t("main.search.description")}</Text></View>}
      {results?.map((result) => <SearchResultCard key={result.recordId} result={result} query={query} onPress={() => onOpenResult(result.recordId)} />)}
      {results && !results.length ? <Text style={styles.searchEmptyHint}>{t("main.search.empty_hint")}</Text> : null}
    </ScrollView>
    <CollectionPickerModal visible={collectionPickerVisible} title={t("main.search.choose_category")} collections={collections} value={collectionId} includeAll onClose={() => setCollectionPickerVisible(false)} onSelect={(value) => { setCollectionPickerVisible(false); onCollectionChange(value); }} />
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
    ? t("main.search.field.related")
    : match?.field === "original"
      ? t("card_detail.original")
      : match?.field === "organization"
        ? t("card_detail.translation")
        : match?.field === "reply"
          ? t("card_detail.reply")
          : t("main.search.field.expression");
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
            <Text style={styles.searchMatchLabel}>{fieldLabel}{match?.matchType === "variant" ? ` · ${t("main.search.variant")}` : ""}</Text>
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
  return date.toLocaleDateString(getLanguage(), { month: "short", day: "numeric" });
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
  onPress?: (origin?: CardDetailRequest["origin"]) => void;
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
    if (processing || !onPress) return;
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
        {record.thumbnail ? <View ref={thumbnailRef} collapsable={false} style={styles.thumbnailFrame}><FocusedCardThumbnail thumbnail={record.thumbnail} onError={onThumbnailError} /></View> : null}
        <View style={styles.cardTextColumn}>
          {processing ? (
            <>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.cardTitle}>{record.displayTitle}</Text>
              <Text numberOfLines={record.thumbnail ? 2 : 3} ellipsizeMode="tail" style={styles.originalText}>{previewText}</Text>
              <Text style={styles.processingText}>{t("main.card.processing")}</Text>
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
            {record.isSample ? <Text style={styles.sampleBadge}>{t("main.card.sample")}</Text> : null}
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

function FocusedCardThumbnail({ thumbnail, onError }: {
  thumbnail: NonNullable<CardRecordSummary["thumbnail"]>;
  onError: () => void;
}) {
  const frameWidth = 108;
  const frameHeight = 72;
  const scale = Math.max(frameWidth / Math.max(1, thumbnail.width), frameHeight / Math.max(1, thumbnail.height));
  const width = thumbnail.width * scale;
  const height = thumbnail.height * scale;
  const focusX = Math.max(0, Math.min(1, thumbnail.focusX ?? 0.5));
  const focusY = Math.max(0, Math.min(1, thumbnail.focusY ?? 0.5));
  return <Image source={{ uri: thumbnail.url }} resizeMode="stretch" style={{ position: "absolute", left: -(width - frameWidth) * focusX, top: -(height - frameHeight) * focusY, width, height }} onError={onError} />;
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
  homeSectionTabs: { flex: 1, height: 48, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, transform: [{ translateX: 21 }] },
  homeHeaderTitle: { maxWidth: "86%", color: theme.colors.text, fontSize: 17, lineHeight: 23, fontWeight: "600" },
  selectionHeaderTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  headerDate: { color: theme.colors.textMuted, fontSize: 13 },
  headerActions: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 2 },
  recordButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentStrong, flexDirection: "row", alignItems: "center", gap: 5 },
  recordButtonText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  headerIconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  headerAssistantUnavailable: { opacity: 0.42 },
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
  recallShortcuts: { marginHorizontal: 22, marginBottom: 8, paddingVertical: 6, flexDirection: "row", gap: 7 },
  recallShortcut: { flex: 1, minHeight: 44, paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  memoryRoundShortcut: { borderColor: "#BBDCD1", backgroundColor: "#EAF6F1" },
  memoryRoundShortcutText: { color: "#446A5D" },
  memoryRoundResumeText: { marginTop: 2, color: "#64877B", fontSize: 9, fontWeight: "600" },
  memoryRoundDot: { position: "absolute", top: 8, right: 9, width: 6, height: 6, borderRadius: 3, backgroundColor: "#72BEA6" },
  recallShortcutTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "500" },
  batchActionBar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 64, paddingTop: 8, paddingHorizontal: 62, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", justifyContent: "space-between" },
  batchActionBarCentered: { justifyContent: "center" },
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
  unifiedComposerDock: { position: "absolute", left: 18, right: 18 },
  inspirationCard: { marginBottom: 8, minHeight: 64, paddingLeft: 12, paddingRight: 10, paddingVertical: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: "#D5E4DF", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.98)", flexDirection: "row", alignItems: "center", gap: 9, shadowColor: "#000000", shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  inspirationPrompt: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  inspirationCopy: { flex: 1, minWidth: 0 },
  inspirationName: { color: "#5E8175", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  inspirationQuestion: { marginTop: 1, color: theme.colors.text, fontSize: 14, lineHeight: 19, fontWeight: "500" },
  inspirationActions: { flexDirection: "row", alignItems: "center", gap: 3 },
  inspirationAction: { minHeight: 32, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 3 },
  inspirationActionText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  inspirationAssistant: { width: 34, height: 34, borderWidth: StyleSheet.hairlineWidth, borderColor: "#CFE4DC", borderRadius: 17, backgroundColor: "#EAF6F1", alignItems: "center", justifyContent: "center" },
  unifiedComposerBar: { minHeight: 50, padding: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: "#D9DEDC", borderRadius: 25, backgroundColor: "rgba(255,255,255,0.97)", flexDirection: "row", alignItems: "center", gap: 7, shadowColor: "#000000", shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 9 },
  unifiedComposerInput: { flex: 1, minHeight: 40, maxHeight: 96, paddingHorizontal: 5, borderRadius: 20, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 8 },
  unifiedComposerAdd: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  unifiedComposerTextInput: { flex: 1, minHeight: 40, maxHeight: 88, paddingVertical: 9, paddingRight: 5, color: theme.colors.text, fontSize: 15, lineHeight: 21 },
  unifiedComposerMic: { width: 30, height: 30, borderRadius: 15, flexShrink: 0 },
  unifiedComposerSend: { width: 34, height: 34, marginHorizontal: 3, borderRadius: 17, backgroundColor: theme.colors.accentStrong, alignItems: "center", justifyContent: "center" },
  unifiedComposerSendDisabled: { opacity: 0.7 },
  modalPage: { flex: 1, backgroundColor: theme.colors.canvas },
  modalHeader: { minHeight: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  modalHeaderButton: { width: 62, minHeight: 44, alignItems: "center", justifyContent: "center" },
  modalTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 16, fontWeight: "500" },
  modalTitleSpacer: { flex: 1 },
  modalCancel: { color: theme.colors.textSecondary, fontSize: 15 },
  modalSend: { color: theme.colors.accentStrong, fontSize: 15, fontWeight: "600" },
  collectionNameSheet: { flex: 1 },
  collectionNameSheetBody: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 44 },
  collectionNameSheetContext: { marginBottom: 10, color: theme.colors.textMuted, fontSize: 13, lineHeight: 19 },
  collectionNameSheetInput: { minHeight: 52, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 16 },
  collectionNameEditorCard: { padding: 12, borderRadius: 14, backgroundColor: theme.colors.surface },
  collectionNameSheetConfirm: { color: theme.colors.accentStrong, fontSize: 15, fontWeight: "600" },
  collectionNameSheetConfirmDisabled: { color: theme.colors.textMuted },
  collectionEditor: { padding: 16, flexDirection: "row", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  collectionManagerSortableRow: { width: "100%" },
  collectionManagerRow: { width: "100%", minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.canvas },
  collectionManagerRowContent: { width: "100%", minHeight: 52, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 4 },
  collectionManagerDisclosure: { width: 22, height: 40, alignItems: "center", justifyContent: "center" },
  collectionManagerRowAction: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  collectionManagerInlineCreate: { minHeight: 52, marginRight: 8, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface },
  collectionManagerInlineInput: { flex: 1, minWidth: 0, height: 52, paddingHorizontal: 0, paddingVertical: 0, color: theme.colors.text, fontSize: 15, lineHeight: 20, textAlignVertical: "center" },
  collectionManagerInlineAction: { width: 32, height: 40, alignItems: "center", justifyContent: "center" },
  collectionManagerMoveList: { width: "100%" },
  collectionManagerMoveRow: { minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  collectionManagerMoveSaving: { marginTop: 18 },
  collectionManagerRowSelected: { backgroundColor: "#F5F5F5" },
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
  sidebarSortableCollection: { width: "100%" },
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
  collectionActionBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 20, elevation: 20 },
  collectionActionMenu: { position: "absolute", width: 132, paddingVertical: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  collectionActionRow: { minHeight: 42, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  collectionActionText: { flex: 1, color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  collectionActionDanger: { color: theme.colors.danger },
  collectionActionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8, backgroundColor: theme.colors.border },
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
