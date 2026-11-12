import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Easing, FlatList, Image, Keyboard, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Text, TextInput } from "../components/Typography";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Icon } from "../components/Icon";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library/legacy";
import { readMemoryPhotoSource } from "../services/device/memoryPhotoLibrary";
import { useAndroidBack } from "../hooks/useAndroidBack";
import { subscribeCardEncounters } from "../services/card/cardEncounters";
import { PodcastHome } from "./podcast/PodcastHome";
import { PodcastMiniPlayer, PodcastPlayer } from "./podcast/PodcastPlayer";
import { MemoryPhotoBrowser } from "./home/MemoryPhotoBrowser";
import { MemoryCollectionFilters } from "./home/MemoryCollectionFilters";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Reanimated, { FadeInDown, runOnJS, useAnimatedRef, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Surface, PressableSurface, TabUnderline, coverFillFor, useFirstAppearance } from "../components/surface/Surface";
import { OioMascot, type OioMascotHandle } from "../components/sketch/OioMascot";
import { haptic } from "../feedback/haptics";
import { motion } from "../motion";
import OioCharacter from "../../assets/app/oio-character.svg";
import { Camera, ClockCounterClockwise, Eye, Gift, ImagesSquare, SunHorizon, TrayArrowDown } from "phosphor-react-native";
import { ProgressRing } from "../components/ProgressRing";
import { cardProgressRing } from "../domain/practice/cardProgressRing";
import { isBlindBoxPlayable } from "../domain/blindBox/pickSentence";
import { BlindBoxHome } from "./home/BlindBoxHome";
import { PracticeSetSummary } from "../components/PracticeSetSummary";
import { endPracticeSession, startPracticeSession, type PracticeSessionSummary } from "../services/practice/practiceSession";
import { focusedCoverRect, homeCoverAspect } from "../domain/card/coverAspect";
import { historyChipLabel, TodayDayBar } from "./home/TodayDayBar";
import { historyDays, relativeDayLabel, type HistoryDay } from "./home/todayDays";
import Sortable from "react-native-sortables";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import {
  createCardEntry,
  bootstrapCard,
  subscribeTutorialRestored,
  createCardCollection,
  deleteCardCollection,
  deleteCardRecord,
  getCardTrash,
  restoreCardRecord,
  permanentlyDeleteCardRecord,
  getCardCollections,
  getCardRecordPage,
  getCardDateKeys,
  getCardTaskStatus,
  getCardRecord,
  getCardCapabilities,
  generateCardContent,
  generateCardAutomaticCloze,
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
  type CardRecordDetail,
  type CardCollection,
  type CardCapabilities,
  type RecallCandidate,
  type CardLearningContentType,
  type CardPracticeFilter,
} from "../services/api/cardApi";
import {
  loadCardDraft,
  saveCardDraft,
  type CardDraft,
  type CardDraftImage,
} from "../services/card/cardDraftStorage";
import { libraryCaptureTime, pickedImageSource, type PickedImageSource } from "../services/card/photoCaptureTime";
import { photoTakenTime } from "../services/device/memoryPhotoPolicy";
import { ensureImageUploadQuota } from "../services/usage/imageUploadQuota";
import { quotaExhaustionKindForCode } from "../services/usage/quotaExhaustion";
import { theme } from "../theme";
import { createStyles } from "../styles";
import { CardDetailModal } from "./CardDetailModal";
import type { CardBrowseOptions, CardDetailRequest } from "./CardDetailNavigator";
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
import { getCurrentEntitlement, getUserPreference, getUserProfile, type CurrentEntitlement, type UserProfile } from "../services/api/meApi";
import { getSession } from "../services/auth/authStorage";
import { getCachedEntitlementForUser, setCachedEntitlement } from "../services/entitlement/entitlementCache";
import { stabilizeProfileAvatar, stabilizeSignedImage } from "../services/image/signedImageCache";
import { useRealtimeSttInput } from "../hooks/useRealtimeSttInput";
import { RealtimeSttButton } from "../components/RealtimeSttButton";
import { extractTargetLanguageCorpus } from "@lf/core/text/corpusText";
import { dictionaryLookupErrorKey, lookupDictionary, type DictionaryLookupResult } from "../services/api/dictionaryApi";
import { DictionarySearchResultCard } from "./search/DictionarySearchResultCard";
import { homeDateKey, homeLibraryView, MEMORY_HOME_TABS, memoryHomeCopy, swipedMemoryTab, type MemoryHomeTab } from "./home/memoryHome";
import { memoryBrowseIds, memoryBrowseRound } from "./home/memoryBrowse";

type MainScreenProps = {
  isActive: boolean;
  refreshRevision: number;
  incomingCardDraft?: { id: number; draft: CardDraft } | null;
  onIncomingCardDraftHandled?: (id: number) => void;
  onOpenCard: (recordId: string, initialTab?: CardDetailRequest["initialTab"], origin?: CardDetailRequest["origin"], options?: CardBrowseOptions) => void;
  onOpenRecall: (mode?: "today" | "yesterday" | "recent" | "blind") => void;
  onOpenMemoryRound: () => void;
  memoryRoundResumeAvailable: boolean;
  onOpenAssistant: () => void;
  onOpenAccount: () => void;
};

type LibraryView = "all" | string;

/** Views that are not a real collection id. */
function isPseudoLibraryView(view: LibraryView): boolean {
  return view === "all" || view === "unclassified" || view === "trash" || view === "favorites";
}
type RecordActionAnchor = { x: number; y: number; width: number; height: number };
type StandaloneDictionarySearchState = {
  term: string;
  targetLanguage?: string;
  loading: boolean;
  error: string | null;
  result: DictionaryLookupResult | null;
};

const UNCLASSIFIED_VIEW = "unclassified";
const TRASH_VIEW = "trash";
const FAVORITES_VIEW = "favorites";
const EMPTY_DRAFT: CardDraft = { mode: "rewrite", collectionId: null, title: "", text: "", rewrittenText: "", translationText: "", replyText: "", derivedFromText: "", clientId: null, recordId: null, submitted: false, clozeRanges: [], enabledLayers: { expression: true, translation: false, reply: false }, generateImageDescription: false, images: [] };
const EMPTY_CORPUS_DRAFT: CardDraft = { ...EMPTY_DRAFT, mode: "corpus", enabledLayers: { expression: false, translation: false, reply: false } };
const LIBRARY_PAGE_SIZE = 40;
const BACKGROUND_REFRESH_INTERVAL_MS = 60_000;
const TOPIC_REFRESH_DELAYS_MS = [1_000, 2_000, 3_000, 5_000, 8_000] as const;
const SEARCH_DICTIONARY_HINT_KEY = "lf_home_search_dictionary_hint_v1";

const THUMBNAIL_REFRESH_LEAD_MS = 60_000;
const THUMBNAIL_ERROR_REFRESH_COOLDOWN_MS = 10_000;

export function MainScreen({ isActive, refreshRevision, incomingCardDraft, onIncomingCardDraftHandled, onOpenCard, onOpenRecall, onOpenMemoryRound, memoryRoundResumeAvailable, onOpenAssistant, onOpenAccount }: MainScreenProps) {
  const screenInsets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const appLocale = getLanguage();
  const homeCopy = memoryHomeCopy(appLocale);
  const [homeTab, setHomeTab] = useState<MemoryHomeTab>("memory");
  const touchingCollectionFilters = useRef(false);
  const touchingCollectionFiltersShared = useSharedValue(false);
  const [photoBrowser, setPhotoBrowser] = useState<"today" | "random" | null>(null);
  const [photoBrowserHidden, setPhotoBrowserHidden] = useState(false);
  const [photoSourceMenuVisible, setPhotoSourceMenuVisible] = useState(false);
  const [podcastPlayerVisible, setPodcastPlayerVisible] = useState(false);
  useAndroidBack(photoSourceMenuVisible, () => setPhotoSourceMenuVisible(false));
  const photoConfirmLock = useRef(false);
  // Display (2026-11 round 3): 方格 (uniform tiles) / 瀑布 (masonry) / 列表, remembered
  // per tab — 回忆 defaults to 方格, 今日 to 瀑布. Order and filters are shared.
  const [homeLayout, setHomeLayout] = useState<HomeLayout>("grid");
  const [localDay, setLocalDay] = useState(() => toDateKey(new Date()));
  useEffect(() => {
    const updateDay = () => setLocalDay(toDateKey(new Date()));
    const timer = setInterval(updateDay, 30_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") updateDay(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const [rememberedLibraryView, setLibraryView] = useState<LibraryView>("all");
  const libraryView = homeLibraryView(homeTab, rememberedLibraryView);
  // 今日 can show another day (‹ › / calendar / history); null follows the real today.
  const [viewDay, setViewDay] = useState<string | null>(null);
  const shownDay = viewDay && viewDay < localDay ? viewDay : localDay;
  const dateScope = homeDateKey(homeTab, libraryView === TRASH_VIEW, new Date(`${shownDay}T12:00:00`));
  const [todayLayout, setTodayLayout] = useState<HomeLayout>("waterfall");
  const [todayCalendarVisible, setTodayCalendarVisible] = useState(false);
  const [historyDayKeys, setHistoryDayKeys] = useState<HistoryDay[]>([]);
  useEffect(() => {
    if (homeTab !== "today") return;
    let active = true;
    const targets = historyDays(localDay);
    // One request covers every "this day in history" chip: keep the days that have cards.
    const keys = targets.map((target) => target.dateKey).sort();
    void getCardDateKeys(keys[0]!, keys[keys.length - 1]!)
      .then((keys) => { if (active) setHistoryDayKeys(targets.filter((target) => keys.includes(target.dateKey))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [homeTab, localDay]);
  // ⋯ filters (2026-11): photo / video presence and learning progress.
  const [mediaFilter, setMediaFilter] = useState<"all" | "with" | "without">("all");
  const [practiceFilter, setPracticeFilter] = useState<"all" | CardPracticeFilter>("all");
  const queryScope = JSON.stringify([libraryView, dateScope, mediaFilter, practiceFilter]);
  const [recordsScope, setRecordsScope] = useState(queryScope);
  const previousDateScopeRef = useRef(dateScope);
  const [sortMode, setSortMode] = useState<"shuffle" | "newest" | "oldest">("shuffle");
  const shuffleSeed = useRef(Crypto.randomUUID());
  // Cards just made here stay first (a shuffle refresh used to move them away)
  // until the user reshuffles or switches folder.
  const pinnedRecordIdsRef = useRef<string[]>([]);
  const homeListRef = useRef<FlashListRef<CardRecordSummary>>(null);
  const [libraryMenuVisible, setLibraryMenuVisible] = useState(false);
    const [selectingRecords, setSelectingRecords] = useState(false);
  // 今日 is a single-column feed (big photo, then words — like Threads / 朋友圈);
  // 回忆 keeps the two-column masonry.
  // 今日 defaults to the single-column feed; ⋯ can switch it to the waterfall grid.
  const activeLayout: HomeLayout = libraryView === TRASH_VIEW ? "list" : homeTab === "today" ? todayLayout : homeLayout;
  const setActiveLayout = homeTab === "today" ? setTodayLayout : setHomeLayout;
  // 今日's 列表 is the big single-column feed; 回忆's is the compact list.
  const todayFeed = homeTab === "today" && activeLayout === "list";
  const gridLayout = activeLayout !== "list";
  const uniformGrid = activeLayout === "grid";
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [batchMoveVisible, setBatchMoveVisible] = useState(false);
  const [cardCapabilities, setCardCapabilities] = useState<CardCapabilities>(DEFAULT_CARD_CAPABILITIES);
  const cardLimits = cardCapabilities.limits;
  const [records, setRecords] = useState<CardRecordSummary[]>([]);
  const recordsRef = useRef<CardRecordSummary[]>([]);
  const [collections, setCollections] = useState<CardCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<RecallCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [dictionarySearch, setDictionarySearch] = useState<StandaloneDictionarySearchState | null>(null);
  const [searchDictionaryHintVisible, setSearchDictionaryHintVisible] = useState(false);
  const [searchCollectionId, setSearchCollectionId] = useState<string | null | undefined>(undefined);
  const [composerVisible, setComposerVisible] = useState(false);
  const [quickNoteExpanded, setQuickNoteExpanded] = useState(false);
  const composerTransition = useRef(new Animated.Value(0)).current;
  const composerClosingRef = useRef(false);
  const [quickNoteCreating, setQuickNoteCreating] = useState(false);
  const [quickNoteAddMenuVisible, setQuickNoteAddMenuVisible] = useState(false);
  const [quickNoteLineCount, setQuickNoteLineCount] = useState(1);
  const [androidQuickNoteContentHeight, setAndroidQuickNoteContentHeight] = useState(44);
  const quickNoteAnimatedHeight = useSharedValue(37);
  const quickNoteAnimatedHeightStyle = useAnimatedStyle(() => ({ height: quickNoteAnimatedHeight.value }));
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const quickNoteKeyboardDockStyle = useAnimatedStyle(() => {
    if (sidebarVisible) return { transform: [{ translateY: 0 }] };
    const keyboardTravel = Math.max(0, -keyboardHeight.value);
    const safeAreaOffset = Math.min(screenInsets.bottom, keyboardTravel);

    return {
      transform: [{ translateY: keyboardHeight.value + safeAreaOffset }],
    };
  }, [screenInsets.bottom, sidebarVisible]);
  const [recordMoveTarget, setRecordMoveTarget] = useState<CardRecordSummary | null>(null);
  const [recordActionMenu, setRecordActionMenu] = useState<{ record: CardRecordSummary; anchor: RecordActionAnchor } | null>(null);
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
  const searchDictionaryAbortRef = useRef<AbortController | null>(null);
  const submitInFlightRef = useRef(false);
  const quickNoteInputRef = useRef<TextInput>(null);
  const quickNoteGenerationQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const quickNoteStt = useRealtimeSttInput({
    value: draft.text,
    onChangeText: (value) => void updateDraftText(value),
    disabled: quickNoteCreating || composerVisible,
    languageCode: appLocale,
    postRefinement: true,
  });
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);
  useEffect(() => {
    sidebarProfileRef.current = sidebarProfile;
  }, [sidebarProfile]);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(SEARCH_DICTIONARY_HINT_KEY).then((seen) => {
      if (active && !seen) setSearchDictionaryHintVisible(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => () => searchDictionaryAbortRef.current?.abort(), []);
  function commitDraft(next: CardDraft): Promise<void> {
    draftRevisionRef.current += 1;
    draftRef.current = next;
    setDraft(next);
    return saveCardDraft(next);
  }

  function updateCommittedDraft(update: (current: CardDraft) => CardDraft): Promise<void> {
    return commitDraft(update(draftRef.current));
  }
  function showCardComposer(): void {
    composerClosingRef.current = false;
    composerTransition.stopAnimation();
    composerTransition.setValue(0);
    setComposerVisible(true);
    requestAnimationFrame(() => {
      Animated.timing(composerTransition, {
        toValue: 1,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }
  function closeCardComposer(): void {
    if (composerClosingRef.current) return;
    composerClosingRef.current = true;
    composerTransition.stopAnimation();
    Animated.timing(composerTransition, {
      toValue: 0,
      duration: 150,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      composerClosingRef.current = false;
      setComposerVisible(false);
      if (draftRef.current.mode === "corpus") {
        void loadCardDraft("rewrite").then((saved) => commitDraft(saved));
      }
    });
  }
  async function openCorpusComposer(): Promise<void> {
    const saved = await loadCardDraft("corpus");
    await commitDraft({ ...saved, mode: "corpus", enabledLayers: { expression: false, translation: false, reply: false } });
    showCardComposer();
  }
  useEffect(() => {
    if (!incomingCardDraft || handledIncomingDraftIdRef.current === incomingCardDraft.id) return;
    handledIncomingDraftIdRef.current = incomingCardDraft.id;
    const next = incomingCardDraft.draft;
    const open = async () => {
      await commitDraft(next);
      showCardComposer();
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

  const refresh = useCallback(async (requestedShuffleSeed = shuffleSeed.current) => {
    const sequence = ++refreshSequenceRef.current;
    loadMoreSequenceRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(false);
    setLoading(true);
    try {
      const collectionId = isPseudoLibraryView(libraryView) ? undefined : libraryView;
      const [rows, collectionResult] = await Promise.all([
        libraryView === TRASH_VIEW ? getCardTrash().then((items) => ({ items, nextCursor: null })) : getCardRecordPage({
          dateKey: dateScope,
          collectionId,
          unclassified: libraryView === UNCLASSIFIED_VIEW,
          favorites: libraryView === FAVORITES_VIEW,
          media: mediaFilter === "all" ? undefined : mediaFilter,
          practice: practiceFilter === "all" ? undefined : practiceFilter,
          limit: LIBRARY_PAGE_SIZE,
          sort: sortMode === "oldest" ? "oldest" : "newest",
          shuffleSeed: sortMode !== "shuffle" ? undefined : requestedShuffleSeed,
        }),
        getCardCollections(),
      ]);
      if (sequence !== refreshSequenceRef.current) return;
      const incomingRecords = rows.items.map((record) => isCardRecordGenerationInProgress(record.id) ? { ...record, status: "processing" as const } : record);
      const stableRecords = await stabilizeRecordThumbnails(recordsRef.current, incomingRecords);
      if (sequence !== refreshSequenceRef.current) return;
      // Commit the round with its cards/cursor, never before a request succeeds.
      // A failed refresh must leave the previous page usable for load-more.
      shuffleSeed.current = requestedShuffleSeed;
      // Pin only in the unfiltered 回忆 grid; elsewhere a pinned card may not belong.
      const pinScope = libraryView === "all" && !dateScope && mediaFilter === "all" && practiceFilter === "all";
      setRecords(pinScope ? pinNewRecords(stableRecords, recordsRef.current, pinnedRecordIdsRef.current) : stableRecords);
      setRecordsScope(queryScope);
      setCollections(collectionResult.collections);
      setNextCursor(rows.nextCursor);
      hasLoadedRef.current = true;
      lastRefreshAtRef.current = Date.now();
      if (!isPseudoLibraryView(libraryView) && !collectionResult.collections.some((collection) => collection.id === libraryView)) {
        setLibraryView("all");
      }
    } catch {
      if (sequence !== refreshSequenceRef.current) return;
      Alert.alert(t("main.error.load_title"), t("main.error.network_retry"));
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false);
    }
  }, [libraryView, sortMode, dateScope, queryScope, mediaFilter, practiceFilter]);

  useEffect(() => {
    if (previousDateScopeRef.current === dateScope) return;
    previousDateScopeRef.current = dateScope;
    // Invalidate the previous tab's in-flight pages before loading its new scope.
    refreshSequenceRef.current += 1;
    loadMoreSequenceRef.current += 1;
    setRecords([]);
    setNextCursor(null);
    void refresh();
  }, [dateScope]);

  useEffect(() => subscribeTutorialRestored(() => { void refresh(); }), [refresh]);

  useEffect(() => subscribeCardEncounters((recordId, encounterCount) => {
    setRecords((current) => current.map((record) => record.id === recordId && record.practiceSummary
      ? { ...record, practiceSummary: { ...record.practiceSummary, encounterCount } }
      : record));
  }), []);

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
    if (recordsScope !== queryScope || loading || loadingMoreRef.current || !nextCursor || searchResults) return;
    const loadSequence = ++loadMoreSequenceRef.current;
    const refreshSequence = refreshSequenceRef.current;
    const requestedView = libraryView;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const collectionId = isPseudoLibraryView(libraryView) ? undefined : libraryView;
      const page = await getCardRecordPage({
        dateKey: dateScope,
        collectionId,
        unclassified: libraryView === UNCLASSIFIED_VIEW,
        favorites: libraryView === FAVORITES_VIEW,
        media: mediaFilter === "all" ? undefined : mediaFilter,
        practice: practiceFilter === "all" ? undefined : practiceFilter,
        limit: LIBRARY_PAGE_SIZE,
        cursor: nextCursor,
        sort: sortMode === "oldest" ? "oldest" : "newest",
        shuffleSeed: sortMode !== "shuffle" ? undefined : shuffleSeed.current,
      });
      if (
        loadSequence !== loadMoreSequenceRef.current
        || refreshSequence !== refreshSequenceRef.current
        || requestedView !== libraryView
      ) return;
      setRecords((current) => [...current, ...page.items.filter((row) => !current.some((item) => item.id === row.id))]);
      setNextCursor(page.nextCursor);
    } catch {
      // Retain cards and cursor, with an explicit retry instead of a silent end.
      if (loadSequence === loadMoreSequenceRef.current && refreshSequence === refreshSequenceRef.current) setLoadMoreError(true);
    } finally {
      if (loadSequence === loadMoreSequenceRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [libraryView, loading, nextCursor, searchResults, sortMode, dateScope, recordsScope, queryScope, mediaFilter, practiceFilter]);

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

  const observedFilterRef = useRef(`${mediaFilter}:${practiceFilter}`);
  useEffect(() => {
    const becameActive = isActive && !previousActiveRef.current;
    previousActiveRef.current = isActive;
    if (!isActive) return;
    const revisionChanged = observedRevisionRef.current !== refreshRevision;
    const libraryChanged = observedLibraryViewRef.current !== libraryView;
    const sortChanged = observedSortModeRef.current !== sortMode;
    // ⋯ filters change the query too (they used to leave the list empty).
    const filterKey = `${mediaFilter}:${practiceFilter}`;
    const filterChanged = observedFilterRef.current !== filterKey;
    observedFilterRef.current = filterKey;
    observedRevisionRef.current = refreshRevision;
    observedLibraryViewRef.current = libraryView;
    observedSortModeRef.current = sortMode;
    const stale = Date.now() - lastRefreshAtRef.current >= BACKGROUND_REFRESH_INTERVAL_MS;
    if (!hasLoadedRef.current || revisionChanged || libraryChanged || sortChanged || filterChanged || (becameActive && stale)) void refresh();
  }, [isActive, libraryView, refresh, refreshRevision, sortMode, mediaFilter, practiceFilter]);

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

  async function updateDraftImageDescription(generateImageDescription: boolean): Promise<void> {
    await updateCommittedDraft((current) => ({ ...current, generateImageDescription }));
  }

  async function updateDraftCollection(collectionId: string | null): Promise<void> {
    const current = draftRef.current;
    const next = { ...current, collectionId, clientId: current.recordId ? current.clientId : null, submitted: false };
    await commitDraft(next);
  }

  function openCardComposer(): void {
    setQuickNoteAddMenuVisible(false);
    if (quickNoteStt.status !== "idle") void quickNoteStt.toggle();
    const hasDraftContent = Boolean(draft.title.trim() || draft.text.trim() || draft.rewrittenText.trim() || draft.translationText.trim() || draft.replyText.trim() || draft.images.length);
    if (!hasDraftContent) {
      void commitDraft({ ...draftRef.current, collectionId: null });
    }
    showCardComposer();
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
          let detail = snapshot.text.trim()
            ? await updateCardContent(created.id, {
                title: snapshot.title.trim() || null,
                originalText: snapshot.text.trim(),
                collectionId: snapshot.collectionId,
                ...(!snapshot.enabledLayers.expression ? { rewrittenText: null } : {}),
                translationText: null,
                ...(!snapshot.enabledLayers.reply ? { replyText: null } : {}),
              })
            : await getCardRecord(created.id);
          const generation = await generateMissingCardContent(detail, selectedTargets);
          detail = generation.detail;
          let auxiliaryFailed = false;
          const auxiliaryBlock = detail.contentBlocks.find((block) => block.contentType === (detail.rewrittenText?.trim() ? "rewrite" : "original"));
          if (auxiliaryBlock && auxiliaryBlock.contentType !== "rewrite" && !auxiliaryBlock.auxiliarySegments?.length) {
            try {
              detail = await generateCardContent(created.id, "auxiliary", auxiliaryBlock.contentType);
            } catch (error) {
              auxiliaryFailed = true;
              console.warn("[card] generate quick note auxiliary text failed", error);
            }
          }
          if (!snapshot.clozeRanges.length) {
            const contentTypes = automaticClozeContentTypes(detail, selectedTargets);
            if (contentTypes.length) detail = await generateCardAutomaticCloze(detail.id, contentTypes).catch((error) => {
              console.warn("[card] automatic cloze failed", error);
              return detail;
            });
          }
          const failedTargets = [...new Set([
            ...generation.failedTargets,
            ...(auxiliaryFailed ? ["auxiliary" as const] : []),
          ])];
          await setCardGenerationState(created.id, failedTargets.length
            ? { pendingTargets: [], failedTargets }
            : null);
          setRecords((current) => current.map((row) => row.id === created.id ? { ...detail, status: "completed" } : row));
          if (!failedTargets.length) {
            if ((detail.originalText.trim() || detail.rewrittenText?.trim()) && !detail.title && !detail.topic) refreshGeneratedTopic(created.id);
            try {
              await saveDraftClozeRanges(created.id, snapshot.clozeRanges);
            } catch (error) {
              console.warn("[card] save quick note cloze failed", error);
            }
          }
        } catch (error) {
          console.warn("[card] quick note generation failed", error);
          await setCardGenerationState(created.id, { pendingTargets: [], failedTargets: trackedGenerationTargets(snapshot, selectedTargets) });
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
    let snapshot = draftRef.current;
    const preparedCorpusDraft = await prepareCorpusDraftForSave(snapshot);
    if (!preparedCorpusDraft) return;
    snapshot = preparedCorpusDraft;
    const text = snapshot.text.trim();
    const count = countGraphemes(text);
    if ((count < 1 && snapshot.images.length < 1) || count > cardLimits.contentChars) {
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
            mode: snapshot.mode,
            collectionId: snapshot.collectionId,
            title: snapshot.title.trim() || null,
            originalText: text,
            rewrittenText: existingContent.expression || null,
            translationText: null,
            replyText: existingContent.reply || null,
            generateRewrite: false,
            generateImageDescription: snapshot.generateImageDescription,
            imageUploadIds: snapshot.images.map((image) => image.uploadId).filter((uploadId): uploadId is string => Boolean(uploadId)),
            link: snapshot.link ? { url: snapshot.link.url, title: snapshot.link.title } : null,
          });
      const firstDraftImage = snapshot.images[0];
      if (firstDraftImage?.uploadId && ((firstDraftImage.focusX ?? 0.5) !== 0.5 || (firstDraftImage.focusY ?? 0.5) !== 0.5)) {
        const createdDetail = await getCardRecord(created.id);
        const coverImageId = createdDetail.images?.[0]?.id;
        if (coverImageId) created = await updateCardCoverPosition(created.id, coverImageId, firstDraftImage.focusX ?? 0.5, firstDraftImage.focusY ?? 0.5);
      }
      persistedRecordId = created.id;
      const selectedTargets: CardGenerationTarget[] = [
        ...(text && snapshot.mode === "rewrite" ? ["expression" as const] : []),
        ...(snapshot.images.length && snapshot.generateImageDescription ? ["image_description" as const] : []),
      ];
      const trackedTargets = trackedGenerationTargets(snapshot, selectedTargets);
      await commitDraft({ ...submitting, recordId: persistedRecordId });
      await setCardGenerationState(created.id, { pendingTargets: trackedTargets, failedTargets: [] });
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
      await commitDraft(snapshot.mode === "corpus" ? EMPTY_CORPUS_DRAFT : EMPTY_DRAFT);
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

  async function submit(initialTab: CardDetailRequest["initialTab"] = "review", options?: { openAfterCreate?: boolean; onCreated?: (recordId: string) => void }): Promise<void> {
    if (submitInFlightRef.current) return;
    if (isCardGenerationInProgress()) {
      Alert.alert(t("main.error.try_later"), t("main.error.card_processing"));
      return;
    }
    let snapshot = draftRef.current;
    const preparedCorpusDraft = await prepareCorpusDraftForSave(snapshot);
    if (!preparedCorpusDraft) return;
    snapshot = preparedCorpusDraft;
    const text = snapshot.text.trim();
    const count = countGraphemes(text);
    if ((count < 1 && snapshot.images.length < 1) || count > cardLimits.contentChars) {
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
    const selectedTargets: CardGenerationTarget[] = [
      ...(text && snapshot.mode === "rewrite" ? ["expression" as const] : []),
      ...(snapshot.images.length && snapshot.generateImageDescription ? ["image_description" as const] : []),
    ];
    const trackedTargets = trackedGenerationTargets(snapshot, selectedTargets);
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
            mode: snapshot.mode,
            collectionId: snapshot.collectionId,
            title: snapshot.title.trim() || null,
            originalText: text || null,
            rewrittenText: existingContent.expression || null,
            translationText: null,
            replyText: existingContent.reply || null,
            generateRewrite: false,
            generateImageDescription: snapshot.generateImageDescription,
            imageUploadIds: snapshot.images.map((image) => image.uploadId).filter((uploadId): uploadId is string => Boolean(uploadId)),
            link: snapshot.link ? { url: snapshot.link.url, title: snapshot.link.title } : null,
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
      pinnedRecordIdsRef.current = [created.id, ...pinnedRecordIdsRef.current.filter((id) => id !== created.id)].slice(0, 12);
      await commitDraft({ ...submitting, recordId: persistedRecordId });

      await setCardGenerationState(created.id, { pendingTargets: trackedTargets, failedTargets: [] });
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
        // Show the new memory: it lands first, so bring the list back to the top.
        setTimeout(() => homeListRef.current?.scrollToOffset({ offset: 0, animated: true }), 350);
      } else {
        setLibraryView("all");
      }
      optimisticStarted = true;
      setComposerVisible(false);
      setActiveRecordId(null);
      await commitDraft(snapshot.mode === "corpus" ? EMPTY_CORPUS_DRAFT : EMPTY_DRAFT);
      setSending(false);
      options?.onCreated?.(created.id);
      if (options?.openAfterCreate !== false) onOpenCard(created.id, initialTab);
      if (snapshot.mode === "corpus") {
        void loadCardDraft("rewrite").then((saved) => commitDraft(saved));
      }

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
      let auxiliaryFailed = false;
      const auxiliaryBlock = detail.contentBlocks.find((block) => block.contentType === (detail.rewrittenText?.trim() ? "rewrite" : "original"));
      if (auxiliaryBlock && auxiliaryBlock.contentType !== "rewrite" && !auxiliaryBlock.auxiliarySegments?.length) {
        try {
          detail = await generateCardContent(detail.id, "auxiliary", auxiliaryBlock.contentType);
        } catch (error) {
          auxiliaryFailed = true;
          console.warn("[card] generate converted auxiliary text failed", error);
        }
      }
      if (!snapshot.clozeRanges.length) {
        const contentTypes = automaticClozeContentTypes(detail, selectedTargets);
        if (contentTypes.length) detail = await generateCardAutomaticCloze(detail.id, contentTypes).catch((error) => {
          console.warn("[card] automatic cloze failed", error);
          return detail;
        });
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
      const failedTargets = [...new Set([
        ...generation.failedTargets,
        ...(auxiliaryFailed ? ["auxiliary" as const] : []),
      ])];
      await setCardGenerationState(created.id, failedTargets.length
        ? { pendingTargets: [], failedTargets }
        : null);
      setRecords((current) => [{ ...createdForDisplay, status: "completed" }, ...current.filter((row) => row.id !== created.id)]);
      if (failedTargets.length) {
        snapshot.images.forEach((image) => removePersistentDraftImage(image.localUri));
        await refresh();
        return;
      }
      if (snapshot.text.trim() && !created.title && !created.topic) refreshGeneratedTopic(created.id);
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
        await setCardGenerationState(persistedRecordId, { pendingTargets: [], failedTargets: trackedTargets });
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
      const alreadyPresent = current.images.some((candidate) => candidate.localUri === image.localUri);
      // Upload callbacks can arrive after the user removes a thumbnail. Only the
      // initial pending image may be inserted; later states update an existing row.
      if (!alreadyPresent && image.status !== "pending") return current;
      const images = alreadyPresent
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
      if (error instanceof CardApiError && quotaExhaustionKindForCode(error.code)) {
        // Refused on quota (the dialog is already showing): take the photo back out.
        void updateCommittedDraft((current) => ({ ...current, images: current.images.filter((candidate) => candidate.localUri !== image.localUri) }));
        removePersistentDraftImage(image.localUri);
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

  /** 📷 on the dock: take a photo, then write about it in the full editor. */
  async function captureMemoryPhoto(): Promise<void> {
    Keyboard.dismiss();
    const added = await pickImage("camera");
    if (added > 0) openCardComposer();
  }

  async function pickImage(source: "camera" | "library"): Promise<number> {
    const remaining = cardLimits.imagesPerCard - draft.images.length;
    if (remaining <= 0) {
      Alert.alert(t("card_detail.photo.limit_title"));
      return 0;
    }
    if (source === "camera" || Platform.OS !== "android") {
      const permission = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t("card_detail.photo.permission_title"), source === "camera" ? t("card_detail.photo.camera_permission_message") : t("card_detail.photo.library_permission_message"));
        return 0;
      }
    }
    const result = source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: true, selectionLimit: remaining, exif: true });
    const selected = result.assets?.filter((asset) => asset.uri && asset.width && asset.height) ?? [];
    if (result.canceled || !selected.length) return 0;
    if (selected.length > remaining) Alert.alert(t("card_detail.photo.limit_title"), tf("card_detail.photo.selection_limited", { count: remaining }));
    const accepted = selected.slice(0, remaining).map((asset) => pickedImageSource(asset, source === "camera"));
    return applyDraftImages(accepted);
  }

  /**
   * Photo inspiration: create a memory from one photo without leaving the
   * browser. Resolves with the new card id once it exists (generation keeps
   * running in the background), or null when it could not be created.
   */
  async function confirmMemoryPhoto(asset: MediaLibrary.Asset, text: string, title = "", collectionId?: string | null): Promise<string | null | "refused"> {
    if (photoConfirmLock.current) return null;
    const current = draftRef.current;
    const revision = draftRevisionRef.current;
    if (current.mode !== "rewrite" || current.text.trim() || current.title.trim() || current.images.length || current.recordId || sending) {
      Alert.alert(t("card_detail.error.cannot_save"), getLanguage().startsWith("zh") ? "请先保存或处理已有草稿，再生成照片回忆。" : "Please finish your existing draft before creating a photo memory.");
      return null;
    }
    if (isCardGenerationInProgress()) {
      Alert.alert(t("main.error.try_later"), t("photo_flow.previous_generating"));
      return null;
    }
    photoConfirmLock.current = true;
    try {
      // The caller has explicitly confirmed upload and generation. Never invoke
      // this path from photo browsing, paging, or the initial selection action.
      const source = await readMemoryPhotoSource(asset, true);
      const prepared = await prepareCardDraftImage({ ...source, capturedAt: libraryCaptureTime(photoTakenTime(asset)), sourceAssetId: asset.id });
      if (draftRevisionRef.current !== revision) { removePersistentDraftImage(prepared.localUri); return null; }
      // One check before uploading; when the allowance is used up, refuse and keep browsing.
      if (!await ensureImageUploadQuota({ count: 1, bytes: prepared.fileSize })) {
        removePersistentDraftImage(prepared.localUri);
        return "refused";
      }
      await commitDraft({ ...EMPTY_DRAFT, collectionId: collectionId === undefined ? current.collectionId : collectionId, title, text, generateImageDescription: true, images: [prepared] });
      try {
        const ready = await uploadCardDraftImage(prepared, persistDraftImage);
        await updateCommittedDraft((value) => ({ ...value, images: [ready] }));
      } catch (error) {
        if (error instanceof CardApiError && quotaExhaustionKindForCode(error.code)) {
          // The server refused on quota (dialog already shown): drop the draft, nothing was spent.
          await commitDraft({ ...EMPTY_DRAFT, collectionId: current.collectionId });
          removePersistentDraftImage(prepared.localUri);
          return "refused";
        }
        // Keep the user's words: hand the draft to the full editor to retry.
        await updateCommittedDraft((value) => ({ ...value, images: value.images.map((image) => ({ ...image, status: "failed" as const })) }));
        setPhotoBrowser(null);
        showCardComposer();
        return null;
      }
      return await new Promise<string | null>((resolve) => {
        let settled = false;
        void submit("review", { openAfterCreate: false, onCreated: (recordId) => { settled = true; resolve(recordId); } })
          .finally(() => { if (!settled) resolve(null); });
      });
    } finally { photoConfirmLock.current = false; }
  }

  async function applyDraftImage(selected: PickedImageSource): Promise<void> {
    await applyDraftImages([selected]);
  }

  /**
   * Prepare a picked batch locally, then check the shared photo/video upload
   * allowance once for the whole batch before any upload starts. A batch that
   * does not fit is refused as a whole (the dialog offers recharge / refresh).
   */
  async function applyDraftImages(selected: PickedImageSource[]): Promise<number> {
    const room = cardLimits.imagesPerCard - draftRef.current.images.length;
    if (room <= 0) {
      Alert.alert(t("card_detail.photo.limit_title"));
      return 0;
    }
    const batch = selected.slice(0, room);
    setPreparingDraftImageCount((count) => count + batch.length);
    const prepared: CardDraftImage[] = [];
    try {
      for (const source of batch) {
        try { prepared.push(await prepareCardDraftImage(source)); } catch {
          Alert.alert(t("card_detail.photo.prepare_failed_title"), t("card_detail.photo.prepare_failed_message"));
        }
      }
      if (!await ensureImageUploadQuota({ count: prepared.length, bytes: prepared.reduce((sum, image) => sum + image.fileSize, 0) })) {
        prepared.forEach((image) => removePersistentDraftImage(image.localUri));
        return 0;
      }
      for (const image of prepared) {
        persistDraftImage(image);
        void processDraftImage(image);
      }
      return prepared.length;
    } finally {
      setPreparingDraftImageCount((count) => Math.max(0, count - batch.length));
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

  // 历史今日: open that day as a rising card stack; tapping reviews its cards
  // (whole cards, choice practice). Leaving lights the chip up.
  const [historyDay, setHistoryDay] = useState<{ day: HistoryDay; records: CardRecordSummary[]; loading: boolean } | null>(null);
  const [visitedHistoryDays, setVisitedHistoryDays] = useState<ReadonlySet<string>>(() => new Set());
  const markHistoryVisited = (dateKey: string) => setVisitedHistoryDays((current) => new Set([...current, dateKey]));
  function openHistoryDay(day: HistoryDay): void {
    setHistoryDay({ day, records: [], loading: true });
    void getCardRecordPage({ dateKey: day.dateKey, limit: 50, sort: "oldest" })
      .then((page) => setHistoryDay((current) => current?.day.dateKey === day.dateKey ? { ...current, records: page.items.filter((record) => !record.isSample), loading: false } : current))
      .catch(() => setHistoryDay((current) => current?.day.dateKey === day.dateKey ? { ...current, loading: false } : current));
  }
  function closeHistoryDay(): void {
    if (historyDay) markHistoryVisited(historyDay.day.dateKey);
    setHistoryDay(null);
  }
  function startHistoryReview(ids: string[]): void {
    const day = historyDay?.day;
    setHistoryDay(null);
    if (!ids.length || !day) return;
    onOpenCard(ids[0]!, "cloze", undefined, { browseRecordIds: ids, closeOnBrowseFinish: true, onBrowseSetFinished: () => undefined, onBrowseClosed: () => markHistoryVisited(day.dateKey) });
  }

  // 盲盒 game: one sentence per card, with photos; a 战绩 summary when the set ends.
  const [blindBoxSummary, setBlindBoxSummary] = useState<PracticeSessionSummary | null>(null);
  const lastBlindBoxIdsRef = useRef<string[]>([]);
  function startBlindBoxSet(ids: string[]): void {
    if (!ids.length) return;
    lastBlindBoxIdsRef.current = ids;
    startPracticeSession();
    onOpenCard(ids[0]!, "review", undefined, {
      browseRecordIds: ids,
      practice: "sentence",
      closeOnBrowseFinish: true,
      onBrowseSetFinished: () => undefined,
      onBrowseClosed: () => { const summary = endPracticeSession(); if (summary) setTimeout(() => setBlindBoxSummary(summary), 300); },
    });
  }

  function openDetail(record: CardRecordSummary, origin?: CardDetailRequest["origin"]): void {
    if (record.status !== "completed") {
      Alert.alert(t("card_detail.processing"), t("main.card.processing_message"));
      return;
    }
    if (searchVisible) { onOpenCard(record.id, "review", origin); return; }
    const pool = memoryBrowseIds(records, dateScope);
    // Today follows the day's order, then keeps going into earlier days with cards.
    if (homeTab === "today" && dateScope) {
      let reachedDay = dateScope;
      onOpenCard(record.id, "review", origin, { browseRecordIds: pool, onBrowseNeedMore: async () => {
        const earlier = await previousDayWithCards(reachedDay);
        if (!earlier) return [];
        reachedDay = earlier;
        const page = await getCardRecordPage({ dateKey: earlier, limit: LIBRARY_PAGE_SIZE });
        return memoryBrowseIds(page.items, earlier);
      } });
      return;
    }
    // 回忆: no 1/10 sets any more — swipe on endlessly; each batch prefers unseen cards.
    const first = memoryBrowseRound(pool, record.id);
    onOpenCard(record.id, "review", origin, { browseRecordIds: first, onBrowseNeedMore: async (seen) => {
      const unseen = pool.filter((id) => !seen.includes(id));
      const source = unseen.length ? unseen : pool.filter((id) => id !== seen[seen.length - 1]);
      const start = source[Math.floor(Math.random() * source.length)];
      return start ? memoryBrowseRound(source, start) : [];
    } });
  }

  async function submitSearch(): Promise<void> {
    const query = searchQuery.trim();
    if (!query) {
      clearSearch();
      return;
    }
    searchDictionaryAbortRef.current?.abort();
    const dictionaryController = new AbortController();
    searchDictionaryAbortRef.current = dictionaryController;
    const sequence = ++searchSequenceRef.current;
    setSearching(true);
    setSearchResults(null);
    setDictionarySearch({ term: query, loading: true, error: null, result: null });
    try {
      const collectionId = searchCollectionId === null ? "unclassified" : searchCollectionId;
      const cardSearch = searchCardsLexically({ q: query, collectionId, limit: 50 });
      const dictionaryLookup = getUserPreference().then(async (preference) => ({
        targetLanguage: preference.learningLanguage,
        result: await lookupDictionary({
          term: query,
          context: query,
          selectionStart: 0,
          selectionEnd: query.length,
          targetLanguage: preference.learningLanguage,
          uiLanguage: getLanguage(),
          contactId: "curious_companion",
          messageId: null,
          lookupMode: "standalone",
          signal: dictionaryController.signal,
        }),
      }));
      const cardTask = cardSearch.then((rows) => {
        if (sequence === searchSequenceRef.current) setSearchResults(rows);
      }).catch(() => {
        if (sequence !== searchSequenceRef.current) return;
        setSearchResults([]);
        Alert.alert(t("main.search.failed"), t("main.error.network_retry"));
      });
      const dictionaryTask = dictionaryLookup.then(({ result, targetLanguage }) => {
        if (sequence === searchSequenceRef.current) setDictionarySearch({ term: query, targetLanguage, loading: false, error: null, result });
      }).catch((error) => {
        if (sequence !== searchSequenceRef.current || dictionaryController.signal.aborted) return;
        console.warn("[main] standalone dictionary lookup failed", error);
        setDictionarySearch({ term: query, loading: false, error: t(dictionaryLookupErrorKey(error)), result: null });
      });
      await Promise.allSettled([cardTask, dictionaryTask]);
    } finally {
      if (searchDictionaryAbortRef.current === dictionaryController) searchDictionaryAbortRef.current = null;
      if (sequence === searchSequenceRef.current) setSearching(false);
    }
  }

  function updateSearchQuery(value: string): void {
    searchSequenceRef.current += 1;
    searchDictionaryAbortRef.current?.abort();
    searchDictionaryAbortRef.current = null;
    setSearchQuery(value);
    setSearchResults(null);
    setDictionarySearch(null);
    setSearching(false);
  }

  function clearSearch(): void {
    searchSequenceRef.current += 1;
    searchDictionaryAbortRef.current?.abort();
    searchDictionaryAbortRef.current = null;
    setSearchQuery("");
    setSearchResults(null);
    setDictionarySearch(null);
    setSearching(false);
  }

  useAndroidBack(isActive && selectingRecords, () => leaveRecordSelection());
  useAndroidBack(isActive && quickNoteExpanded, () => setQuickNoteExpanded(false));
  useAndroidBack(isActive && recordActionMenu !== null, () => setRecordActionMenu(null));
  useAndroidBack(isActive && searchVisible, () => closeSearch());
  useAndroidBack(isActive && sidebarVisible, () => setSidebarVisible(false));
  function closeSearch(): void {
    searchSequenceRef.current += 1;
    searchDictionaryAbortRef.current?.abort();
    searchDictionaryAbortRef.current = null;
    setSearching(false);
    setSearchVisible(false);
    Keyboard.dismiss();
  }

  function openSearch(): void {
    setSearchDictionaryHintVisible(false);
    void AsyncStorage.setItem(SEARCH_DICTIONARY_HINT_KEY, "1").catch(() => undefined);
    setSearchCollectionId(undefined);
    setSearchVisible(true);
  }

  function selectLibraryView(view: LibraryView): void {
    clearSearch();
    setHomeTab("memory");
    setLibraryView(view);
  }

  function hideTutorial(recordId: string): void {
    void deleteCardRecord(recordId)
      .then(() => {
        setRecords((rows) => rows.filter((row) => row.id !== recordId));
        void refresh();
      })
      .catch(() => Alert.alert(t("main.error.delete_failed")));
  }

  function confirmDelete(recordId: string): void {
    if (records.find((record) => record.id === recordId)?.isSample) {
      Alert.alert(t("tutorial.hide"), t("tutorial.hint"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("tutorial.hide"), onPress: () => void deleteCardRecord(recordId)
          .then(() => setRecords((rows) => rows.filter((row) => row.id !== recordId)))
          .catch(() => Alert.alert(t("main.error.delete_failed"))) },
      ]);
      return;
    }
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
      if (libraryView === UNCLASSIFIED_VIEW ? collectionId !== null : libraryView !== "all" && libraryView !== FAVORITES_VIEW && libraryView !== collectionId) {
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
    haptic.light();
    setLibraryMenuVisible(true);
  }

  function enterRecordSelection(): void {
    setLibraryMenuVisible(false);
    setSelectingRecords(true);
    setSelectedRecordIds(new Set());
  }

  function selectLibrarySort(mode: "shuffle" | "newest" | "oldest"): void {
    pinnedRecordIdsRef.current = [];
    if (mode === "shuffle" && sortMode === "shuffle") shuffleSeed.current = Crypto.randomUUID();
    setSortMode(mode);
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

  // Left / right swipe switches home tabs. A gesture-handler pan runs alongside
  // the lists' native vertical scrolling (a PanResponder never got the touch).
  const switchHomeTab = useCallback((dx: number, dy: number) => {
    setHomeTab((current) => {
      const next = swipedMemoryTab(current, dx, dy);
      if (next !== current) haptic.select();
      return next;
    });
  }, []);
  const homeTabsSwipeEnabled = isActive && !sidebarVisible && !searchVisible && !composerVisible && !quickNoteExpanded
    && !photoBrowser && !selectingRecords && libraryView !== TRASH_VIEW;
  const homeTabsSwipe = useMemo(() => Gesture.Pan()
    .enabled(homeTabsSwipeEnabled)
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .onEnd((event) => {
      if (touchingCollectionFiltersShared.value) return;
      runOnJS(switchHomeTab)(event.translationX, event.translationY);
    }), [homeTabsSwipeEnabled, switchHomeTab, touchingCollectionFiltersShared]);


  const quickNoteExplicitLineCount = draft.text.split("\n").length;
  const quickNoteActualLineCount = Math.max(1, quickNoteLineCount, quickNoteExplicitLineCount);
  const quickNoteVisibleLineCount = Math.min(7, quickNoteActualLineCount);
  const quickNoteInputHeight = 20 + quickNoteVisibleLineCount * 24;
  const androidQuickNoteInputHeight = draft.text.length === 0
    ? 44
    : Math.max(44, Math.min(188, Math.ceil(androidQuickNoteContentHeight)));
  const quickNoteSendDisabled = quickNoteCreating || quickNoteStt.status !== "idle" || (!draft.text.trim() && !draft.images.length)
    || preparingDraftImageCount > 0 || draft.images.some((image) => image.status !== "ready");
  const quickNoteNeedsFullEditor = draft.text.length > 0
    && (quickNoteActualLineCount >= 3 || draft.text.length >= 100);
  useEffect(() => {
    quickNoteAnimatedHeight.value = withTiming(quickNoteInputHeight, { duration: 120 });
  }, [quickNoteAnimatedHeight, quickNoteInputHeight]);
  useEffect(() => {
    if (Platform.OS === "android" && draft.text.length === 0) setAndroidQuickNoteContentHeight(44);
  }, [draft.text.length]);
  const updateQuickNoteText = quickNoteStt.onChangeText;
  const editorialHome = homeTab === "memory" && libraryView !== TRASH_VIEW;
  const headerMascot = useRef<OioMascotHandle>(null);

  return (
    <SafeAreaView style={[styles.container, libraryView !== TRASH_VIEW && styles.editorialCanvas]}>
      <View style={styles.brandRow}>
        <Pressable accessibilityLabel={selectingRecords ? t("common.cancel") : t("quick_note.a11y.open_nav")} style={styles.headerIconButton} onPress={() => {
          if (selectingRecords) {
            leaveRecordSelection();
            return;
          }
          Keyboard.dismiss();
          setSidebarVisible(true);
        }}>
          <Icon name={selectingRecords ? "close" : "menu-outline"} size={27} color={theme.colors.text} />
        </Pressable>
        {selectingRecords
          ? <Text style={styles.selectionHeaderTitle}>{selectedRecordIds.size}</Text>
          : libraryView === TRASH_VIEW
            ? <View style={styles.homeSectionTabs}><Text numberOfLines={1} style={styles.homeHeaderTitle}>{headerTitle}</Text></View>
            : <View style={styles.homeSectionTabs} accessibilityRole="tablist">
              {MEMORY_HOME_TABS.map((tab) => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: homeTab === tab }} hitSlop={6} style={styles.memoryTab} onPress={() => { if (homeTab !== tab) haptic.select(); setHomeTab(tab); }}><Text style={[styles.memoryTabText, homeTab === tab && styles.memoryTabSelected]}>{tab === "today" ? relativeDayLabel(shownDay, localDay, getLanguage()) : homeCopy[tab]}</Text>{homeTab === tab ? <TabUnderline key={tab} width={28} style={styles.memoryTabUnderline} /> : <View style={styles.memoryTabUnderlineSpace} />}</Pressable>)}
            </View>}
        <View style={styles.headerActions}>
          {!selectingRecords ? <Pressable accessibilityRole="button" accessibilityLabel={t("contact.curious_companion.name")} hitSlop={8} style={styles.headerCharacter} onPressIn={() => headerMascot.current?.hop()} onPress={() => { haptic.light(); void openAssistant(); }}><OioMascot ref={headerMascot} size={29} /></Pressable> : null}
          {selectingRecords ? <Pressable accessibilityRole="button" accessibilityLabel={gridLayout ? homeCopy.list : homeCopy.grid} style={styles.headerIconButton} onPress={() => setActiveLayout(gridLayout ? "list" : "grid")}><Icon name={gridLayout ? "list-outline" : "grid-outline"} size={22} color={theme.colors.text} /></Pressable> : <Pressable
            accessibilityLabel={t("quick_note.a11y.search")}
            style={styles.headerIconButton}
            onPress={openSearch}
          >
            <Icon name="search-outline" size={23} color={theme.colors.text} />
          </Pressable>}
          {!selectingRecords && searchDictionaryHintVisible ? <Pressable accessibilityRole="button" accessibilityLabel={t("main.search.new_hint")} style={styles.searchDictionaryCoachmark} onPress={openSearch}>
            <Text style={styles.searchDictionaryCoachmarkText}>{t("main.search.new_hint")}</Text>
            <View style={styles.searchDictionaryCoachmarkArrow} />
          </Pressable> : null}
        </View>
      </View>

      <GestureDetector gesture={homeTabsSwipe}><View style={{ flex: 1 }}>
      {!selectingRecords && editorialHome ? <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}><View style={{ flex: 1, minWidth: 0 }}><MemoryCollectionFilters editorial={editorialHome} collections={collections} selected={libraryView} onSelect={selectLibraryView} onTouching={value => { touchingCollectionFilters.current = value; touchingCollectionFiltersShared.value = value; }} /></View><Pressable accessibilityRole="button" accessibilityLabel={t("library.display_options")} hitSlop={6} style={[styles.headerIconButton, { marginRight: 10 }]} onPress={chooseLibraryAction}><Icon name="ellipsis-horizontal" size={21} color={theme.colors.textSecondary} /></Pressable></View> : null}
      {homeTab === "podcast" && libraryView !== TRASH_VIEW && !selectingRecords ? <PodcastHome collections={collections} bottomInset={screenInsets.bottom} onOpenPlayer={() => setPodcastPlayerVisible(true)} /> : homeTab === "blind" && libraryView !== TRASH_VIEW && !selectingRecords ? <View style={{ flex: 1, minHeight: 0 }}>
        <BlindBoxHome records={recordsScope === queryScope ? records : []} loading={loading || loadingMore} hasMore={recordsScope === queryScope && Boolean(nextCursor)} onLoadMore={() => void loadMore()} onStart={startBlindBoxSet} />
      </View> : <>
      {!selectingRecords && libraryView !== TRASH_VIEW && homeTab === "today" ? <TodayDayBar
        day={shownDay}
        today={localDay}
        history={historyDayKeys}
        visited={visitedHistoryDays}
        onOpenHistory={openHistoryDay}
        onChangeDay={(day) => setViewDay(day >= localDay ? null : day)}
        onOpenCalendar={() => setTodayCalendarVisible(true)}
        onOpenMenu={chooseLibraryAction}
      /> : null}

      <FlashList
        ref={homeListRef}
        key={`${activeLayout}:${dateScope ?? "all"}`}
        numColumns={gridLayout ? 2 : 1}
        masonry={activeLayout === "waterfall"}
        refreshing={loading && records.length > 0}
        onRefresh={() => { void refresh(Crypto.randomUUID()); }}
        style={styles.libraryList}
        data={[...(recordsScope === queryScope ? records : [])].filter((record) => (!selectingRecords || !record.isSample) && (!dateScope || record.dateKey === dateScope)).sort((a, b) => Number(b.isSample) - Number(a.isSample))}
        keyExtractor={(record) => record.id}
        renderItem={({ item: record, index }) => (
          <CardCard enterIndex={index} grid={gridLayout} uniform={uniformGrid} feed={todayFeed} record={record} collectionName={record.collectionId ? collections.find((collection) => collection.id === record.collectionId)?.name : undefined} selecting={selectingRecords} selected={selectedRecordIds.has(record.id)} onPress={(origin) => selectingRecords ? toggleRecordSelection(record.id) : libraryView === TRASH_VIEW ? undefined : void openDetail(record, origin)} onOpenActions={(anchor) => openRecordActions(record, anchor)} onHideTutorial={() => hideTutorial(record.id)} onThumbnailError={recoverFailedThumbnail} />
        )}
        ListHeaderComponent={homeTab === "memory" && !selectingRecords && libraryView !== TRASH_VIEW ? <View style={gridLayout ? styles.gridHeader : undefined}><MemoryRoundShortcut active={isActive} resume={memoryRoundResumeAvailable} onPress={onOpenMemoryRound} /></View> : null}
        contentContainerStyle={gridLayout ? styles.gridList : todayFeed ? styles.todayList : styles.list}
        alwaysBounceVertical
        bounces
        showsVerticalScrollIndicator
        onEndReachedThreshold={0.45}
        onEndReached={() => void loadMore()}
        ListEmptyComponent={loading ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loader} /> : (
          <View style={styles.emptyCard}>
            {libraryView !== TRASH_VIEW ? <OioMascot size={84} style={styles.emptyMascot} /> : null}
            {libraryView === "all" || homeTab === "today" ? <>
              <Text style={styles.emptyTitle}>{homeTab === "today" ? (shownDay === localDay ? homeCopy.todayEmpty : homeCopy.dayEmpty) : t("quick_note.empty_cards")}</Text>
              <Text style={styles.emptyText}>{homeTab === "today" ? homeCopy.todayHint : t("quick_note.empty_cards_hint")}</Text>
            </> : null}
            {libraryView === TRASH_VIEW ? <Text style={styles.emptyText}>{t("library.trash_empty")}</Text> : homeTab !== "today" ? <PressableSurface radius={22} fill={theme.colors.accent} feedback="medium" accessibilityRole="button" style={styles.emptyAction} contentStyle={styles.emptyActionInner} onPress={openCardComposer}>
              <Text style={styles.emptyActionText}>{homeCopy.create}</Text>
            </PressableSurface> : null}
          </View>
        )}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={theme.colors.accentStrong} style={styles.loadMoreIndicator} /> : loadMoreError ? <Pressable accessibilityRole="button" onPress={() => void loadMore()} style={{ minHeight: 44, padding: 16, alignItems: "center" }}><Text style={{ color: theme.colors.textMuted }}>{t("main.error.network_retry")}</Text><Text style={{ color: theme.colors.accentStrong }}>{t("common.retry")}</Text></Pressable> : null}
      />
      </>}
      </View></GestureDetector>
      <RecordActionSheet
        record={recordActionMenu?.record ?? null}
        trash={libraryView === TRASH_VIEW}
        bottomInset={screenInsets.bottom}
        onClose={() => setRecordActionMenu(null)}
        onRestore={(record) => { setRecordActionMenu(null); restoreFromTrash(record.id); }}
        onMove={(record) => { setRecordActionMenu(null); openMoveActions(record); }}
        onDelete={(record) => { setRecordActionMenu(null); confirmDelete(record.id); }}
      />
      {!selectingRecords && libraryView !== TRASH_VIEW ? <PodcastMiniPlayer showResume={homeTab === "podcast"} bottom={homeTab === "podcast" ? Math.max(screenInsets.bottom + 10, 14) : Math.max(screenInsets.bottom + 10, 14) + 74} onOpen={() => setPodcastPlayerVisible(true)} /> : null}
      <PodcastPlayer visible={podcastPlayerVisible} onClose={() => setPodcastPlayerVisible(false)} />
      {!selectingRecords && libraryView !== TRASH_VIEW && homeTab !== "podcast" ? <Surface radius={28} fill={theme.colors.surface} style={[styles.memoryEntryDock, { bottom: Math.max(screenInsets.bottom + 10, 14) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("card_detail.photo.camera")} style={({ pressed }) => [styles.memoryPhotoShortcut, pressed && styles.memoryPhotoShortcutPressed]} onPress={() => { haptic.medium(); void captureMemoryPhoto(); }}>
          <Camera size={25} color={theme.colors.text} />
          <Text style={styles.memoryEntryLabel}>{homeCopy.camera}</Text>
        </Pressable>
        <PressableSurface radius={12} fill={theme.colors.accent} feedback="medium" accessibilityRole="button" accessibilityLabel={t("quick_note.expand_editor")} contentStyle={styles.memoryEntryButton} onPress={openCardComposer}>
          <Icon name="add" size={24} color={theme.colors.onAccent} weight="bold" />
          {draft.text || draft.images.length ? <View style={styles.memoryDraftDot} /> : null}
        </PressableSurface>
        <Pressable accessibilityRole="button" accessibilityLabel={homeCopy.photos} style={({ pressed }) => [styles.memoryPhotoShortcut, pressed && styles.memoryPhotoShortcutPressed]} onPress={() => { haptic.light(); Keyboard.dismiss(); setPhotoSourceMenuVisible(true); }}>
          <ImagesSquare size={25} color={theme.colors.text} />
          <Text style={styles.memoryEntryLabel}>{homeCopy.photos}</Text>
        </Pressable>
      </Surface> : null}
      {historyDay ? <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={closeHistoryDay}>
        <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.feed }} edges={["top", "bottom"]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} style={styles.historyClose} onPress={closeHistoryDay}><Icon name="chevron-back" size={24} color={theme.colors.text} /></Pressable>
          <BlindBoxHome variant="history" title={`${historyChipLabel(historyDay.day)} · ${historyDay.day.dateKey.replace(/^(\d+)-0?(\d+)-0?(\d+)$/u, "$1.$2.$3")}`} records={historyDay.records} loading={historyDay.loading} hasMore={false} onLoadMore={() => undefined} onStart={startHistoryReview} />
        </SafeAreaView></SafeAreaProvider>
      </Modal> : null}
      <PracticeSetSummary summary={blindBoxSummary} onClose={() => setBlindBoxSummary(null)} onAgain={() => {
        setBlindBoxSummary(null);
        const pool = records.filter((record) => record.status === "completed" && !record.isSample && isBlindBoxPlayable(record.practiceSummary)).map((record) => record.id);
        const previous = new Set(lastBlindBoxIdsRef.current);
        const fresh = pool.filter((id) => !previous.has(id));
        const source = fresh.length ? fresh : pool;
        startBlindBoxSet([...source].sort(() => Math.random() - 0.5).slice(0, Math.max(1, lastBlindBoxIdsRef.current.length)));
      }} />
      <PhotoSourceMenu visible={photoSourceMenuVisible} bottomInset={screenInsets.bottom} onClose={() => setPhotoSourceMenuVisible(false)} onPick={(mode) => { setPhotoSourceMenuVisible(false); setPhotoBrowserHidden(false); setPhotoBrowser(mode); }} />
      {selectingRecords && selectedRecordIds.size ? <View style={[styles.batchActionBar, libraryView === TRASH_VIEW && styles.batchActionBarCentered, { paddingBottom: Math.max(screenInsets.bottom, 10) }]}>{libraryView !== TRASH_VIEW ? <Pressable style={styles.batchAction} onPress={() => setBatchMoveVisible(true)}><Icon name="folder-open-outline" size={22} color={theme.colors.text} /><Text style={styles.batchActionText}>{t("library.move")}</Text></Pressable> : null}<Pressable style={styles.batchAction} onPress={confirmBatchDelete}><Icon name="trash-outline" size={22} color={theme.colors.danger} /><Text style={[styles.batchActionText, { color: theme.colors.danger }]}>{libraryView === TRASH_VIEW ? "彻底删除" : t("common.delete")}</Text></Pressable></View> : null}
      <Modal visible={libraryMenuVisible} transparent animationType="fade" onRequestClose={() => setLibraryMenuVisible(false)}>
        <Pressable style={styles.libraryMenuBackdrop} onPress={() => setLibraryMenuVisible(false)}>
          <Surface radius={16} fill={theme.colors.surface} style={[styles.displayMenuPanel, { top: screenInsets.top + 104 }]}>
            <Pressable onPress={() => undefined} style={styles.displayMenuInner}>
              <Text style={styles.displayMenuLabel}>{t("library.layout")}</Text>
              <View style={styles.displayMenuSegment}>
                {(["grid", "waterfall", "list"] as const).map((layout) => <Pressable key={layout} accessibilityRole="radio" accessibilityState={{ checked: activeLayout === layout }} style={[styles.displayMenuOption, activeLayout === layout && styles.displayMenuOptionOn]} onPress={() => { haptic.select(); setActiveLayout(layout); }}>
                  <Icon name={layout === "list" ? "list-outline" : "grid-outline"} size={16} color={activeLayout === layout ? theme.colors.onAccent : theme.colors.text} />
                  <Text style={[styles.displayMenuOptionText, activeLayout === layout && styles.displayMenuOptionTextOn]}>{t(layout === "grid" ? "library.layout_grid" : layout === "waterfall" ? "today.layout_waterfall" : "library.layout_list")}</Text>
                </Pressable>)}
              </View>
              {<><Text style={styles.displayMenuLabel}>{t("library.order")}</Text>
              <View style={styles.displayMenuSegment}>
                {(["shuffle", "newest", "oldest"] as const).map((mode) => <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: sortMode === mode }} style={[styles.displayMenuOption, sortMode === mode && styles.displayMenuOptionOn]} onPress={() => { haptic.select(); selectLibrarySort(mode); }}>
                  <Text style={[styles.displayMenuOptionText, sortMode === mode && styles.displayMenuOptionTextOn]}>{t(mode === "shuffle" ? "library.order_shuffle" : mode === "newest" ? "library.order_newest" : "library.order_oldest")}</Text>
                </Pressable>)}
              </View></>}
              <Text style={styles.displayMenuLabel}>{t("library.filter_media")}</Text>
              <View style={styles.displayMenuSegment}>
                {(["all", "with", "without"] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mediaFilter === value }} style={[styles.displayMenuOption, mediaFilter === value && styles.displayMenuOptionOn]} onPress={() => { haptic.select(); setMediaFilter(value); }}>
                  <Text style={[styles.displayMenuOptionText, mediaFilter === value && styles.displayMenuOptionTextOn]}>{t(`library.filter_media_${value}`)}</Text>
                </Pressable>)}
              </View>
              <Text style={styles.displayMenuLabel}>{t("library.filter_practice")}</Text>
              <View style={[styles.displayMenuSegment, styles.displayMenuWrap]}>
                {(["all", "unclozed", "unanswered", "mistakes", "perfect"] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: practiceFilter === value }} style={[styles.displayMenuOption, styles.displayMenuChip, practiceFilter === value && styles.displayMenuOptionOn]} onPress={() => { haptic.select(); setPracticeFilter(value); }}>
                  <Text style={[styles.displayMenuOptionText, practiceFilter === value && styles.displayMenuOptionTextOn]}>{t(`library.filter_practice_${value}`)}</Text>
                </Pressable>)}
              </View>
              <View style={styles.libraryMenuDivider} />
              {/* Same size as the options above (it used the old sidebar row style). */}
              <Pressable accessibilityRole="button" style={styles.displayMenuOption} onPress={enterRecordSelection}>
                <Icon name="checkmark-circle-outline" size={17} color={theme.colors.text} />
                <Text style={styles.displayMenuOptionText}>{t("library.multi_select")}</Text>
              </Pressable>
            </Pressable>
          </Surface>
        </Pressable>
      </Modal>
      <AnimatedSearchOverlay visible={searchVisible}>
        <CardSearchScreen
          query={searchQuery}
          results={searchResults}
          searching={searching}
          dictionarySearch={dictionarySearch}
          collections={collections}
          collectionId={searchCollectionId}
          onClose={closeSearch}
          onQueryChange={updateSearchQuery}
          onSearch={() => void submitSearch()}
          onCollectionChange={(value) => { setSearchCollectionId(value); setSearchResults(null); }}
          onCreateCollection={createDraftCollection}
          onOpenResult={(recordId) => onOpenCard(recordId)}
        />
      </AnimatedSearchOverlay>

      {photoBrowser ? <MemoryPhotoBrowser random={photoBrowser === "random"} hidden={photoBrowserHidden} maxTextLength={cardLimits.contentChars} collections={collections} defaultCollectionId={draft.collectionId} onCreateCollection={async (name, parentId) => { const created = await createCardCollection(name, parentId); setCollections((value) => [...value, created]); return created; }} onClose={() => setPhotoBrowser(null)} onConfirm={confirmMemoryPhoto} onOpenCard={(recordId) => {
        // Step out of the photo flow to the card, then come back to the same photo.
        setPhotoBrowserHidden(true);
        onOpenCard(recordId, "review", undefined, { onBrowseClosed: () => setPhotoBrowserHidden(false) });
      }} onPracticeSet={(recordIds) => {
        setPhotoBrowser(null);
        const [first] = recordIds;
        if (first) onOpenCard(first, "cloze", undefined, { browseRecordIds: recordIds });
      }} /> : null}
      {composerVisible ? (
        <Modal visible transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={closeCardComposer}>
          <Animated.View style={[styles.composerTransitionPage, {
            opacity: composerTransition,
            transform: [
              { translateY: composerTransition.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
              { scale: composerTransition.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
            ],
          }]}>
          <CardDetailModal
            detail={null}
            loading={false}
            draft={{ value: draft, sending, imageAdding: preparingDraftImageCount > 0 }}
            draftLimits={cardLimits}
            draftCollections={collections}
            draftSafeArea={{ top: screenInsets.top, bottom: screenInsets.bottom }}
            onClose={closeCardComposer}
            onDraftChange={(value) => void updateDraftText(value)}
            onDraftFieldChange={(field, value) => void updateDraftField(field, value)}
            onDraftEnabledLayersChange={(layers) => void updateDraftEnabledLayers(layers)}
            onDraftImageDescriptionChange={(enabled) => void updateDraftImageDescription(enabled)}
            onDraftCollectionChange={(collectionId) => void updateDraftCollection(collectionId)}
            onDraftLinkChange={(link) => void commitDraft({ ...draftRef.current, link, clientId: draftRef.current.recordId ? draftRef.current.clientId : null, submitted: false })}
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
          </Animated.View>
        </Modal>
      ) : null}
      <CollectionPickerModal
        visible={Boolean(recordMoveTarget)}
        title={t("library.move_to")}
        collections={collections}
        value={recordMoveTarget?.collectionId ?? null}
        onClose={() => setRecordMoveTarget(null)}
        onSelect={async (collectionId) => { if (recordMoveTarget) await moveRecord(recordMoveTarget, collectionId ?? null); }}
        onCreateCollection={createDraftCollection}
      />
      <CollectionPickerModal
        visible={batchMoveVisible}
        title={t("library.move_to")}
        collections={collections}
        value={null}
        onClose={() => setBatchMoveVisible(false)}
        onSelect={async (collectionId) => moveSelectedRecords(collectionId ?? null)}
        onCreateCollection={createDraftCollection}
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
        onOpenCorpus={() => closeSidebarThen(() => { void openCorpusComposer(); })}
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
      {/* 今日: tapping the date picks any day from the calendar. */}
      <CardCalendarScreen visible={todayCalendarVisible} onClose={() => setTodayCalendarVisible(false)} onSelectDate={(dateKey) => { setTodayCalendarVisible(false); setViewDay(dateKey >= localDay ? null : dateKey); }} />
    </SafeAreaView>
  );
}

function MemoryRoundShortcut({ active, resume, onPress }: { active: boolean; resume: boolean; onPress: () => void }) {
  const mascot = useRef<OioMascotHandle>(null);
  const draw = useFirstAppearance("home-memory-round");
  const label = t(resume ? "memory_round.resume" : "memory_round.start");
  return <PressableSurface radius={theme.radius.card} fill={theme.colors.accentSoft} feedback="medium" accessibilityRole="button" accessibilityLabel={label} style={styles.memoryRoundBanner} contentStyle={styles.memoryRoundBannerInner} onPressIn={() => mascot.current?.hop()} onPress={onPress}>
    <OioMascot ref={mascot} size={36} idle={active} />
    <Text numberOfLines={1} style={styles.memoryRoundBannerTitle}>{label}</Text>
    <Icon name="arrow-forward" size={20} color={theme.colors.ink} />
  </PressableSurface>;
}

function LibrarySidebar({ visible, activeView, collections, profile, entitlement, onClose, onSelect, onOpenRecall, onOpenAssistant, onOpenCorpus, onOpenCalendar, onCreateCollection, onRenameCollection, onToggleFavorite, onDeleteCollection, onReorderCollection, onReorderFavoriteCollection, onOpenAccount }: {
  visible: boolean;
  activeView: LibraryView;
  collections: CardCollection[];
  profile: UserProfile | null;
  entitlement: CurrentEntitlement | null;
  onClose: () => void;
  onSelect: (view: LibraryView) => void;
  onOpenRecall: () => void;
  onOpenAssistant: () => void;
  onOpenCorpus: () => void;
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
  const collectionScrollRef = useAnimatedRef<ScrollView>();
  const collectionManagerScrollRef = useAnimatedRef<ScrollView>();
  const sidebarCreateRowRef = useRef<View>(null);
  const sidebarScrollViewportRef = useRef<View>(null);
  const sidebarScrollOffsetRef = useRef(0);
  const sidebarAnchorFrameRef = useRef<number | null>(null);
  const [sidebarKeyboardTop, setSidebarKeyboardTop] = useState<number | null>(null);
  // Keep Sortable's animated ref pointing at the underlying native ScrollView.
  const attachCollectionManagerScroll = useCallback((view: ScrollView | null) => {
    collectionManagerScrollRef(view);
  }, [collectionManagerScrollRef]);
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
  const alignSidebarCreateRow = useCallback(() => {
    if (sidebarAnchorFrameRef.current !== null) cancelAnimationFrame(sidebarAnchorFrameRef.current);
    if (!visible || !sidebarInlineCreating) return;
    sidebarAnchorFrameRef.current = requestAnimationFrame(() => {
      sidebarAnchorFrameRef.current = null;
      const row = sidebarCreateRowRef.current;
      row?.measureInWindow((_x, rowTop, _width, rowHeight) => {
        if (!rowHeight || sidebarCreateRowRef.current !== row) return;
        sidebarScrollViewportRef.current?.measureInWindow((_sx, scrollTop) => {
          if (sidebarCreateRowRef.current !== row) return;
          // Stable top anchor; only a taller keyboard/smaller screen may move it up.
          const targetTop = Math.max(scrollTop, Math.min(
            insets.top + 360,
            (sidebarKeyboardTop ?? windowDimensions.height - insets.bottom) - rowHeight - 16,
          ));
          const offset = Math.max(0, sidebarScrollOffsetRef.current + rowTop - targetTop);
          if (Math.abs(offset - sidebarScrollOffsetRef.current) > 1) {
            collectionScrollRef.current?.scrollTo({ y: offset, animated: false });
          }
        });
      });
    });
  }, [visible, sidebarInlineCreating, sidebarKeyboardTop, insets.top, insets.bottom, windowDimensions.height, collectionScrollRef]);

  useEffect(() => {
    if (!visible || !sidebarInlineCreating) return;
    setSidebarKeyboardTop(Keyboard.metrics()?.screenY ?? null);
    const change = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow", (event) => {
      setSidebarKeyboardTop(event.endCoordinates.height > 0 ? event.endCoordinates.screenY : null);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setSidebarKeyboardTop(null));
    return () => { change.remove(); hide.remove(); };
  }, [visible, sidebarInlineCreating]);

  useEffect(() => {
    alignSidebarCreateRow();
    return () => {
      if (sidebarAnchorFrameRef.current !== null) cancelAnimationFrame(sidebarAnchorFrameRef.current);
    };
  }, [alignSidebarCreateRow, creatingParentId]);
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

  function renderCreateRow(depth: number) {
    return (
      <View ref={sidebarCreateRowRef} collapsable={false} onLayout={alignSidebarCreateRow} style={[styles.sidebarCreateRow, { marginLeft: 6 + Math.min(depth, 2) * 18 }]}>
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
          onFocus={alignSidebarCreateRow}
          style={styles.sidebarCreateInput}
        />
        <Pressable accessibilityLabel={t("main.collection.a11y.finish_create")} disabled={!newCollectionName.trim() || savingCollection} hitSlop={8} onPress={() => void createCollection()}>
          {savingCollection
            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            : <Icon name="checkmark-outline" size={22} color={newCollectionName.trim() ? theme.colors.text : theme.colors.textMuted} />}
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
          <Icon name="close-outline" size={22} color={theme.colors.textMuted} />
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
                <Icon name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
              </Pressable>
            ) : <View style={styles.collectionManagerDisclosure} />}
            <Text numberOfLines={1} style={styles.collectionRowName}>{collection.name}</Text>
            {reorderSavingId === collection.id ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : null}
            <Pressable accessibilityLabel={t("main.collection.new_child")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => startCreatingChild(collection)}>
              <Icon name="add-circle-outline" size={19} color={theme.colors.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={t("main.collection.rename")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => startRenaming(collection)}>
              <Icon name="create-outline" size={19} color={theme.colors.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={t("main.collection.move_to")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => startMovingCollection(collection)}>
              <Icon name="move-outline" size={19} color={theme.colors.textMuted} />
            </Pressable>
            <Pressable accessibilityLabel={t("common.delete")} hitSlop={7} style={styles.collectionManagerRowAction} onPress={() => confirmDeleteCollection(collection)}>
              <Icon name="trash-outline" size={19} color={theme.colors.danger} />
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
                : <Icon name="checkmark-circle-outline" size={22} color={newCollectionName.trim() ? theme.colors.accentStrong : theme.colors.textMuted} />}
            </Pressable>
            <Pressable disabled={savingCollection} hitSlop={7} style={styles.collectionManagerInlineAction} onPress={() => { setCreatingParentId(undefined); setNewCollectionName(""); }}>
              <Icon name="close-outline" size={22} color={theme.colors.textMuted} />
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
        <View style={[styles.sidebar, { paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
          <View style={styles.sidebarHeader}>
            <Pressable accessibilityLabel={t("sidebar.settings")} style={styles.sidebarAccount} onPress={onOpenAccount}>
              <View style={styles.sidebarAvatar}>
                {profile?.avatar?.thumbnailUrl
                  ? <Image source={{ uri: profile.avatar.thumbnailUrl }} style={styles.sidebarAvatarImage} />
                  : <Icon name="person-outline" size={19} color={theme.colors.textSecondary} />}
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
              <Icon name="settings-outline" size={21} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
          <View ref={sidebarScrollViewportRef} collapsable={false} style={styles.sidebarCollectionScroller}>
          <Reanimated.ScrollView
            ref={collectionScrollRef}
            onLayout={alignSidebarCreateRow}
            onContentSizeChange={alignSidebarCreateRow}
            onScroll={(event) => { sidebarScrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            automaticallyAdjustKeyboardInsets={false}
            contentInsetAdjustmentBehavior="never"
            style={styles.sidebarCollectionScroller}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical={false}
          >
          <CalendarSidebarPreview onPress={onOpenCalendar} />
          <View style={styles.sidebarFixedContent}>
            <SidebarRow
              leading={<OioCharacter width={25} height={24} />}
              label={t("contact.curious_companion.name")}
              muted={!assistantAvailable}
              onPress={assistantAvailable ? onOpenAssistant : () => Alert.alert(t("sidebar.assistant_members_only_title"), t("sidebar.assistant_members_only_message"))}
            />
            <SidebarRow leading={<ClockCounterClockwise size={22} color={theme.colors.textStrong} weight="duotone" />} label={t("sidebar.recall")} onPress={onOpenRecall} />
            <SidebarRow leading={<TrayArrowDown size={22} color={theme.colors.textStrong} weight="duotone" />} label={t("sidebar.import_corpus")} muted={entitlement?.tier !== "pro"} onPress={entitlement?.tier === "pro" ? onOpenCorpus : () => Alert.alert(t("sidebar.pro_required_title"), t("sidebar.pro_required_message"))} />
          </View>

          <View style={[styles.sidebarCollectionSection, styles.sidebarCollectionContent]}>
                  <View style={styles.sidebarSectionHeader}>
                    <Pressable
                      accessibilityLabel={favoritesExpanded ? t("sidebar.a11y.collapse_favorites") : t("sidebar.a11y.expand_favorites")}
                      style={styles.sidebarSectionToggle}
                      onPress={() => setFavoritesExpanded((expanded) => !expanded)}
                    >
                      <Icon name={favoritesExpanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
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
                      <Icon name={collectionsExpanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} />
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
                        <Icon name="add-outline" size={23} color={theme.colors.text} />
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
          </View>
          {sidebarInlineCreating ? <View style={{ height: windowDimensions.height }} /> : null}
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
                    <Icon name={icon as React.ComponentProps<typeof Ionicons>["name"]} size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.collectionActionText}>{label}</Text>
                  </Pressable>
                ))}
                <View style={styles.collectionActionDivider} />
                <Pressable style={styles.collectionActionRow} onPress={() => selectCollectionAction(2)}>
                  <Icon name="trash-outline" size={18} color={theme.colors.danger} />
                  <Text style={[styles.collectionActionText, styles.collectionActionDanger]}>{t("common.delete")}</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          ) : null}
        </View>
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
        <View style={styles.collectionNameSheet}>
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
          <KeyboardAwareScrollView
            ref={attachCollectionManagerScroll}
            mode="layout"
            bottomOffset={24}
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
                  <Icon name="albums-outline" size={20} color={theme.colors.textSecondary} />
                  <Text style={styles.collectionRowName}>{t("main.collection.top_level")}</Text>
                  {movingCollection.parentId === null ? <Icon name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
                </Pressable>
                {collectionMoveTargets.map(({ collection, depth }) => (
                  <Pressable
                    key={collection.id}
                    style={[styles.collectionManagerMoveRow, { paddingLeft: 14 + depth * 22 }]}
                    disabled={movingCollectionSaving}
                    onPress={() => void moveCollectionFromManager(collection.id)}
                  >
                    <Icon name="folder-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.collectionRowName}>{collection.name}</Text>
                    {movingCollection.parentId === collection.id ? <Icon name="checkmark" size={20} color={theme.colors.accentStrong} /> : null}
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
          </KeyboardAwareScrollView>
        </View>
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
        {expandable ? <Icon name={expanded ? "chevron-down" : "chevron-forward"} size={14} color={theme.colors.textMuted} /> : null}
      </Pressable>
      {icon ? <Icon name={icon} size={19} color={muted ? theme.colors.textMuted : selected ? theme.colors.text : theme.colors.textSecondary} /> : null}
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
            : <Icon name={favorite ? "star" : "star-outline"} size={18} color={favorite ? theme.colors.text : theme.colors.textMuted} />}
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
          <Icon name="ellipsis-horizontal" size={19} color={theme.colors.textMuted} />
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

function CardSearchScreen({ query, results, searching, dictionarySearch, collections, collectionId, onClose, onQueryChange, onSearch, onCollectionChange, onCreateCollection, onOpenResult }: {
  query: string;
  results: RecallCandidate[] | null;
  searching: boolean;
  dictionarySearch: StandaloneDictionarySearchState | null;
  collections: CardCollection[];
  collectionId: string | null | undefined;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onCollectionChange: (value: string | null | undefined) => void;
  onCreateCollection: (name: string, parentId: string | null) => Promise<CardCollection>;
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
  const dictionaryVisualCandidates = (results ?? []).flatMap((result) => result.thumbnail ? [{
    recordId: result.recordId,
    url: result.thumbnail.url,
    label: result.displayTitle,
  }] : []);
  const dictionaryVisuals = Array.from(new Map(dictionaryVisualCandidates.map((visual) => [visual.url, visual])).values()).slice(0, 2);
  return <SafeAreaView style={styles.searchPage}>
    <View style={styles.searchPageHeader}>
      <Pressable accessibilityLabel={t("card_detail.back")} style={styles.searchBackButton} onPress={onClose}><Icon name="chevron-back" size={25} color={theme.colors.text} /></Pressable>
      <View style={styles.searchBox}>
        <Icon name="search" size={18} color={theme.colors.textMuted} />
        <TextInput ref={inputRef} value={query} onChangeText={onQueryChange} onSubmitEditing={onSearch} returnKeyType="search" placeholder={t("main.search.placeholder")} placeholderTextColor={theme.colors.textMuted} style={styles.searchPageInput} />
        {query ? <Pressable accessibilityLabel={t("main.search.clear")} hitSlop={8} onPress={() => onQueryChange("")}><Icon name="close-circle" size={19} color={theme.colors.textMuted} /></Pressable> : null}
      </View>
      <Pressable accessibilityLabel={t("main.search.action")} disabled={!query.trim() || searching} style={[styles.searchPageSubmit, (!query.trim() || searching) && styles.searchPageSubmitDisabled]} onPress={onSearch}>
        {searching ? <ActivityIndicator size="small" color={theme.colors.onInk} /> : <Icon name="arrow-forward" size={19} color={theme.colors.onInk} />}
      </Pressable>
    </View>
    <View style={styles.searchFilters}>
      <Text style={styles.searchCapabilities}>{t("main.search.capabilities")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.searchFilterContent}>
        <Pressable style={[styles.searchFilterChip, collectionId !== undefined && styles.searchFilterChipActive]} onPress={() => setCollectionPickerVisible(true)}>
          <Icon name={collectionId === undefined ? "apps-outline" : "folder-outline"} size={14} color={collectionId !== undefined ? theme.colors.text : theme.colors.textSecondary} />
          <Text numberOfLines={1} style={[styles.searchFilterText, collectionId !== undefined && styles.searchFilterTextActive]}>{collectionLabel}</Text>
          <Icon name="chevron-down" size={13} color={theme.colors.textMuted} />
        </Pressable>
      </ScrollView>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.searchResultsContent} showsVerticalScrollIndicator={false}>
      {dictionarySearch ? <DictionarySearchResultCard {...dictionarySearch} visuals={dictionaryVisuals} onOpenVisual={onOpenResult} /> : null}
      {results ? <>
        <Text style={styles.searchSectionTitle}>{t("main.search.cards_title")}</Text>
        <Text style={styles.searchSummary}>{results.length ? tf("main.search.result_count", { count: results.length }) : t("main.search.empty_hint")}</Text>
      </> : dictionarySearch ? null : <View style={styles.searchStart}><Icon name="search-outline" size={30} color={theme.colors.textFaint} /><Text style={styles.searchStartText}>{t("main.search.description")}</Text></View>}
      {results?.map((result) => <SearchResultCard key={result.recordId} result={result} query={query} onPress={() => onOpenResult(result.recordId)} />)}
    </ScrollView>
    <CollectionPickerModal visible={collectionPickerVisible} title={t("main.search.choose_category")} collections={collections} value={collectionId} includeAll onClose={() => setCollectionPickerVisible(false)} onSelect={(value) => { setCollectionPickerVisible(false); onCollectionChange(value); }} onCreateCollection={onCreateCollection} />
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
          {result.displayTitle.trim() && (match?.field === "title" || match?.field === "topic")
            ? <HighlightedSearchText text={result.displayTitle} term={match.surfaceText || query} />
            : result.displayTitle.trim() ? <Text numberOfLines={1} style={styles.cardTitle}>{result.displayTitle}</Text> : null}
          {match?.field === "title" || match?.field === "topic"
            ? <Text numberOfLines={2} style={styles.originalText}>{result.originalText}</Text>
            : <HighlightedSearchText text={match?.sentence || result.originalText} term={match?.surfaceText || query} />}
          <View style={styles.cardFooter}>
            <Text style={styles.cardTime}>{formatSearchResultDate(result.recordedAt ?? result.createdAt)}</Text>
            <Text style={styles.searchMatchLabel}>{fieldLabel}{match?.matchType === "variant" ? ` · ${t("main.search.variant")}` : ""}</Text>
            <Icon name="chevron-forward" size={16} color={theme.colors.textMuted} />
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

function CardCard({ record, grid = false, uniform = false, feed = false, enterIndex, collectionName, selecting = false, selected = false, onPress, onOpenActions, onThumbnailError, onHideTutorial }: {
  grid?: boolean;
  /** 方格: every tile the same square shape (瀑布 keeps each photo's own shape). */
  uniform?: boolean;
  /** 今日 single-column feed card. */
  feed?: boolean;
  enterIndex?: number;
  record: CardRecordSummary;
  collectionName?: string;
  selecting?: boolean;
  selected?: boolean;
  onPress?: (origin?: CardDetailRequest["origin"]) => void;
  onOpenActions: (anchor: RecordActionAnchor) => void;
  onThumbnailError: () => void;
  onHideTutorial?: () => void;
}) {
  const [coverFrame, setCoverFrame] = useState<{ width: number; height: number } | null>(null);
  const processing = record.status !== "completed";
  const previewText = record.rewrittenPreview?.trim() || record.originalPreview;
  const thumbnailRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const firstAppearance = useFirstAppearance(`home-card-${record.id}`);
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
  // Long press opens the move/delete sheet (replaces the old ⋯ button).
  const longPress = selecting || processing ? undefined : () => {
    haptic.medium();
    onOpenActions({ x: 0, y: 0, width: 0, height: 0 });
  };
  const content = (
      <View style={[styles.cardContent, grid && styles.memoryGridContent]}>
        {selecting ? <View style={[styles.cardSelectionIcon, grid && { position: "absolute", top: 8, right: 8, zIndex: 2, borderRadius: 18, backgroundColor: theme.colors.surface, padding: 3 }]}><Icon name={selected ? "checkmark-circle" : "ellipse-outline"} size={23} color={selected ? theme.colors.text : theme.colors.textMuted} /></View> : null}
        {record.thumbnail ? <View ref={thumbnailRef} collapsable={false} style={grid ? [styles.memoryGridCover, { aspectRatio: uniform ? 1 : homeCoverAspect(record.thumbnail.width, record.thumbnail.height) }] : styles.thumbnailFrame} onLayout={grid ? (event) => setCoverFrame({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height }) : undefined}>{grid
          // Honor the cover position picked in the editor (was always center-cropped).
          ? coverFrame ? <Image source={{ uri: record.thumbnail.url }} resizeMode="stretch" style={{ position: "absolute", ...focusedCoverRect(record.thumbnail, coverFrame, { x: record.thumbnail.focusX, y: record.thumbnail.focusY }) }} onError={onThumbnailError} /> : null
          : <FocusedCardThumbnail thumbnail={record.thumbnail} onError={onThumbnailError} />}</View> : grid ? <View style={[styles.memoryGridCover, styles.memoryTextCover, uniform && styles.memoryTextCoverUniform, { backgroundColor: coverFillFor(record.id) }]}>
          {/* Text-only memory: title, a short rule, then a taste of the English rewrite. */}
          <Text style={styles.memoryTextCoverTitle} numberOfLines={3}>{record.displayTitle.trim() || record.originalPreview}</Text>
          {(record.rewrittenPreview ?? "").trim() ? <>
            <View style={styles.memoryTextCoverRule} />
            <Text style={styles.memoryTextCoverPreview} numberOfLines={3}>{record.rewrittenPreview}</Text>
          </> : null}
        </View> : null}
        {grid && !selecting && !record.isSample && record.practiceSummary?.status && record.practiceSummary.status !== "image_only" ? <CardStatusBadge summary={record.practiceSummary} /> : null}
        <View style={styles.cardTextColumn}>
          {processing ? (
            <>
              {record.displayTitle.trim() ? <Text numberOfLines={grid ? 2 : 1} ellipsizeMode="tail" style={[styles.cardTitle, grid && styles.memoryGridTitle]}>{record.displayTitle}</Text> : null}
              {!grid ? <Text numberOfLines={record.thumbnail ? 2 : 3} ellipsizeMode="tail" style={styles.originalText}>{previewText}</Text> : null}
              <Text style={styles.processingText}>{t("main.card.processing")}</Text>
            </>
          ) : (
            <>
              {record.displayTitle.trim() && (!grid || record.thumbnail) ? <Text numberOfLines={grid ? 2 : 1} ellipsizeMode="tail" style={[styles.cardTitle, grid && styles.memoryGridTitle]}>{record.displayTitle}</Text> : null}
              {!grid ? <Text numberOfLines={record.thumbnail ? 2 : 3} ellipsizeMode="tail" style={styles.originalText}>{previewText}</Text> : null}
            </>
          )}
          <View style={[styles.cardFooter, grid && styles.memoryGridFooter]}>
            <Text numberOfLines={1} style={[styles.cardTime, grid && styles.memoryGridDate]}>{formatCardDateLabel(record.dateKey)}{!grid ? ` · ${formatTime(record.recordedAt ?? record.createdAt)}` : ""}</Text>
            {collectionName && !grid ? <Text numberOfLines={1} style={styles.cardCollection}>{collectionName}</Text> : null}
            {record.isSample ? <>
              <Text style={styles.sampleBadge}>{t("main.card.sample")}</Text>
              <Pressable accessibilityLabel={t("tutorial.hide")} hitSlop={8} onPress={(event) => { event.stopPropagation(); onHideTutorial?.(); }}>
                <Text style={styles.sampleBadge}>{t("tutorial.hide")}</Text>
              </Pressable>
            </> : null}
            {processing ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : record.practiceSummary?.encounterCount !== undefined && !record.isSample ? (
              <View style={styles.cardEncounter} accessibilityLabel={tf("library.encounter_count", { count: record.practiceSummary.encounterCount })}>
                <Eye size={13} color={theme.colors.textMuted} />
                <Text style={styles.cardEncounterText}>{record.practiceSummary.encounterCount}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
  );
  if (feed && !selecting) {
    const enter = firstAppearance && enterIndex !== undefined && enterIndex < motion.maxStaggered
      ? FadeInDown.duration(motion.duration.enter).delay(enterIndex * motion.stagger)
      : undefined;
    const thumb = record.thumbnail;
    const preview = (record.rewrittenPreview?.trim() || record.originalPreview).trim();
    return <Reanimated.View entering={enter}>
      <PressableSurface ref={cardRef} disabled={processing} dimWhenDisabled={false} accessibilityHint={t("library.long_press_hint")} style={styles.todayCard} contentStyle={styles.todayCardInner} onPress={open} onLongPress={longPress} delayLongPress={350}>
        {thumb ? <View ref={thumbnailRef} collapsable={false} style={[styles.todayCover, { aspectRatio: Math.max(0.8, Math.min(1.5, thumb.width / Math.max(1, thumb.height))) }]}>
          <Image source={{ uri: thumb.url }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={onThumbnailError} />
        </View> : null}
        <View style={styles.todayBody}>
          {record.displayTitle.trim() ? <Text numberOfLines={2} style={styles.todayTitle}>{record.displayTitle}</Text> : null}
          {preview ? <Text numberOfLines={thumb ? 3 : 6} style={styles.todayPreview}>{preview}</Text> : null}
          <View style={styles.todayFooter}>
            <Text style={styles.todayTime}>{formatTime(record.recordedAt ?? record.createdAt)}</Text>
            {processing ? <ActivityIndicator size="small" color={theme.colors.accentStrong} /> : record.practiceSummary?.encounterCount !== undefined ? <View style={styles.cardEncounter}>
              <Eye size={14} color={theme.colors.textMuted} />
              <Text style={styles.cardEncounterText}>{record.practiceSummary.encounterCount}</Text>
            </View> : null}
          </View>
        </View>
      </PressableSurface>
    </Reanimated.View>;
  }
  if (grid) {
    const enter = firstAppearance && enterIndex !== undefined && enterIndex < motion.maxStaggered
      ? FadeInDown.duration(motion.duration.enter).delay(enterIndex * motion.stagger)
      : undefined;
    return <Reanimated.View entering={enter} style={styles.memoryGridCell}>
      <PressableSurface ref={cardRef} fill={selected ? theme.colors.accentFaint : theme.colors.surface} disabled={processing} dimWhenDisabled={false} accessibilityState={{ disabled: processing, selected }} accessibilityHint={t("library.long_press_hint")} style={styles.memoryGridCard} contentStyle={styles.memoryGridSketch} onPress={open} onLongPress={longPress} delayLongPress={350}>
        {content}
      </PressableSurface>
    </Reanimated.View>;
  }
  return (
    <Pressable ref={cardRef} style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && styles.cardPressed]} disabled={processing} accessibilityState={{ disabled: processing, selected }} accessibilityHint={t("library.long_press_hint")} onPress={open} onLongPress={longPress} delayLongPress={350}>
      {content}
    </Pressable>
  );
}

/** 🖼 on the dock: choose where the photo inspiration comes from. */
function PhotoSourceMenu({ visible, bottomInset, onClose, onPick }: {
  visible: boolean;
  bottomInset: number;
  onClose: () => void;
  onPick: (mode: "today" | "random") => void;
}) {
  const copy = memoryHomeCopy(getLanguage());
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.actionSheetBackdrop} onPress={onClose} accessibilityLabel={t("common.cancel")} />
    <View pointerEvents="box-none" style={[styles.photoSourceWrap, { bottom: Math.max(bottomInset + 10, 14) + 78 }]}>
      {([["today", SunHorizon, copy.recentPhotos, copy.recentPhotosHint], ["random", Gift, copy.randomPhotos, copy.randomPhotosHint]] as const).map(([mode, Glyph, label, hint]) => <PressableSurface key={mode} radius={18} fill={theme.colors.surface} feedback="light" style={styles.photoSourceOption} contentStyle={styles.photoSourceInner} onPress={() => onPick(mode)}>
        <Glyph size={26} color={theme.colors.text} />
        <Text style={styles.photoSourceLabel}>{label}</Text>
        <Text style={styles.photoSourceHint}>{hint}</Text>
      </PressableSurface>)}
    </View>
  </Modal>;
}

/** iMessage-style bottom actions for a long-pressed card: move / delete (or restore in trash). */
function RecordActionSheet({ record, trash, bottomInset, onClose, onRestore, onMove, onDelete }: {
  record: CardRecordSummary | null;
  trash: boolean;
  bottomInset: number;
  onClose: () => void;
  onRestore: (record: CardRecordSummary) => void;
  onMove: (record: CardRecordSummary) => void;
  onDelete: (record: CardRecordSummary) => void;
}) {
  return <Modal visible={Boolean(record)} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.actionSheetBackdrop} onPress={onClose} accessibilityLabel={t("common.cancel")} />
    {record ? <View style={[styles.actionSheetWrap, { paddingBottom: Math.max(bottomInset, 12) + 8 }]}>
      <Surface radius={20} fill={theme.colors.surface}>
        <Text numberOfLines={1} style={styles.actionSheetTitle}>{record.displayTitle.trim() || record.originalPreview}</Text>
        {trash ? <Pressable style={({ pressed }) => [styles.actionSheetRow, pressed && styles.actionSheetRowPressed]} onPress={() => { haptic.light(); onRestore(record); }}>
          <Icon name="arrow-undo-outline" size={20} /><Text style={styles.actionSheetText}>{t("library.restore")}</Text>
        </Pressable> : !record.isSample ? <Pressable style={({ pressed }) => [styles.actionSheetRow, pressed && styles.actionSheetRowPressed]} onPress={() => { haptic.light(); onMove(record); }}>
          <Icon name="folder-outline" size={20} /><Text style={styles.actionSheetText}>{t("library.move_to")}</Text>
        </Pressable> : null}
        <Pressable style={({ pressed }) => [styles.actionSheetRow, pressed && styles.actionSheetRowPressed]} onPress={() => { haptic.warning(); onDelete(record); }}>
          <Icon name="trash-outline" size={20} color={theme.colors.danger} /><Text style={[styles.actionSheetText, { color: theme.colors.danger }]}>{t(record.isSample ? "tutorial.hide" : "common.delete")}</Text>
        </Pressable>
      </Surface>
      <PressableSurface radius={20} fill={theme.colors.surface} feedback="select" style={styles.actionSheetCancel} contentStyle={styles.actionSheetCancelInner} onPress={onClose}>
        <Text style={styles.actionSheetCancelText}>{t("common.cancel")}</Text>
      </PressableSurface>
    </View> : null}
  </Modal>;
}

/** Completion ring: blanks answered and how many right (replaces the old status icons). */
function CardStatusBadge({ summary }: { summary: CardRecordSummary["practiceSummary"] }) {
  const ring = cardProgressRing(summary);
  return <View style={styles.cardStatusBadge} accessibilityLabel={ring.tone === "empty" ? t("library.status.recorded") : ring.label}>
    <ProgressRing ring={ring} size={20} />
  </View>;
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

function trackedGenerationTargets(draft: CardDraft, selectedTargets: CardGenerationTarget[]): CardGenerationTarget[] {
  return draft.mode === "corpus"
    ? [...(draft.text.trim() ? ["auxiliary" as const] : []), ...selectedTargets.filter((target) => target === "image_description")]
    : selectedTargets;
}

async function prepareCorpusDraftForSave(draft: CardDraft): Promise<CardDraft | null> {
  if (draft.mode !== "corpus" || !draft.text.trim()) return draft;
  let languageCode: string;
  try {
    languageCode = (await getUserPreference()).learningLanguage;
  } catch {
    Alert.alert(t("card_detail.error.cannot_save"), t("main.error.network_retry"));
    return null;
  }
  const extraction = extractTargetLanguageCorpus(draft.text, languageCode);
  if (extraction.excludedSentences.length && !await confirmCorpusLanguageFilter()) return null;
  if (!extraction.text && !draft.images.length) {
    Alert.alert(t("card_detail.corpus_no_target_title"), t("card_detail.corpus_no_target_message"));
    return null;
  }
  return { ...draft, text: extraction.text };
}

function confirmCorpusLanguageFilter(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(t("card_detail.corpus_language_title"), t("card_detail.corpus_language_message"), [
      { text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
      { text: t("card_detail.corpus_language_confirm"), onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

function automaticClozeContentTypes(
  detail: CardRecordDetail,
  targets: CardGenerationTarget[],
): CardLearningContentType[] {
  const result: CardLearningContentType[] = [];
  if (detail.mode === "corpus" && detail.contentBlocks.find((block) => block.contentType === "original")?.learningAccess === "enabled") {
    result.push("original");
  }
  if (targets.includes("expression")) {
    if (detail.rewrittenText?.trim()) result.push("rewrite");
    else if (detail.contentBlocks.find((block) => block.contentType === "original")?.learningAccess === "enabled") result.push("original");
  }
  if (targets.includes("reply") && detail.replyText?.trim()) result.push("reply");
  if (targets.includes("image_description")) {
    result.push(...(detail.images ?? [])
      .filter((image) => image.descriptionText?.trim())
      .map((image) => `image:${image.id}` as const));
  }
  return result;
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
  // Hermes lacks CJK Intl data (came out as "9:48 PM"); 24-hour by hand.
  return Number.isNaN(date.getTime()) ? "" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const editorialFont = Platform.select({ ios: "STSongti-SC-Regular", android: "serif", default: "serif" });

const styles = createStyles(() => ({
  editorialCanvas: { backgroundColor: theme.colors.canvas },
  memoryTab: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingTop: 8 },
  memoryTabActive: {},
  memoryTabText: { fontSize: 17, lineHeight: 24, color: theme.colors.textMuted, fontWeight: "400" },
  memoryTabUnderline: { marginTop: 4 },
  memoryTabUnderlineSpace: { height: 7 },
  memoryTabSelected: { color: theme.colors.text, fontWeight: "600" },
  memoryToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 22, paddingVertical: 8 },
  memoryTodayDate: { color: theme.colors.textSecondary, fontSize: 14 },
  memoryGridRow: { gap: 14, alignItems: "flex-start" },
  photoSourceWrap: { position: "absolute", left: 28, right: 28, flexDirection: "row", gap: 12 },
  photoSourceOption: { flex: 1 },
  photoSourceInner: { minHeight: 112, padding: 14, gap: 6, alignItems: "flex-start", justifyContent: "flex-end" },
  photoSourceLabel: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  photoSourceHint: { color: theme.colors.textMuted, fontSize: 12 },
  actionSheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.scrimLight },
  actionSheetWrap: { position: "absolute", left: 14, right: 14, bottom: 0, gap: 10 },
  actionSheetTitle: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6, color: theme.colors.textMuted, fontSize: 13 },
  actionSheetRow: { minHeight: 52, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 12 },
  actionSheetRowPressed: { backgroundColor: theme.colors.surfacePressed },
  actionSheetText: { color: theme.colors.text, fontSize: 16 },
  actionSheetCancel: {},
  actionSheetCancelInner: { minHeight: 52, alignItems: "center", justifyContent: "center" },
  actionSheetCancelText: { color: theme.colors.text, fontSize: 16, fontWeight: "600" },
  cardStatusBadge: { position: "absolute", top: 6, left: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.surface, opacity: 0.92, alignItems: "center", justifyContent: "center" },
  cardEncounter: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 3 },
  cardEncounterText: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  cardPressed: { backgroundColor: theme.colors.surfacePressed },
  memoryGridCell: { paddingHorizontal: 3.5 },
  memoryGridCard: { marginBottom: 7 },
  memoryGridSketch: { padding: 0 },
  memoryGridContent: { flexDirection: "column", alignItems: "stretch", gap: 0 },
  memoryGridCover: { width: "100%", aspectRatio: 0.85, borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  memoryGridTitle: { fontSize: 14, lineHeight: 20, fontWeight: "500", marginTop: 8, paddingHorizontal: 10, color: theme.colors.text },
  memoryTextCover: { justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 16, paddingVertical: 20, gap: 10 },
  memoryTextCoverTitle: { fontSize: 17, lineHeight: 24, color: theme.colors.text, fontWeight: "700" },
  historyClose: { width: 44, height: 44, marginLeft: 8, alignItems: "center", justifyContent: "center" },
  memoryTextCoverUniform: { aspectRatio: 1, justifyContent: "flex-start", overflow: "hidden" },
  memoryTextCoverRule: { width: 24, height: 2, borderRadius: 1, backgroundColor: theme.colors.textFaint },
  memoryTextCoverPreview: { fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary },
  memoryGridFooter: { flexWrap: "nowrap", gap: 4, marginTop: 6, minHeight: 20, paddingHorizontal: 10, paddingBottom: 10 },
  memoryGridDate: { color: theme.colors.textMuted, fontSize: 12 },
  memoryLanding: { flexGrow: 1, alignItems: "center", justifyContent: "flex-start", gap: 20, padding: 16, paddingBottom: 140, backgroundColor: theme.colors.feed },
  memoryLandingTitle: { fontSize: 19, color: theme.colors.text, textAlign: "center" },
  container: { flex: 1, backgroundColor: theme.colors.canvas },
  brandRow: { minHeight: 56, paddingHorizontal: 12, paddingTop: 4, flexDirection: "row", alignItems: "center" },
  brand: { flex: 1, marginLeft: 10, color: theme.colors.text, fontSize: 20, lineHeight: 27, fontWeight: "500", letterSpacing: -0.2 },
  homeSectionTabs: { flex: 1, height: 48, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 22 },
  homeHeaderTitle: { maxWidth: "86%", ...theme.type.title },
  selectionHeaderTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 17, fontWeight: "600" },
  headerDate: { color: theme.colors.textMuted, fontSize: 13 },
  headerActions: { position: "relative", zIndex: 5, marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 2 },
  headerCharacter: { width: 38, height: 42, alignItems: "center", justifyContent: "center" },
  recordButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, flexDirection: "row", alignItems: "center", gap: 5 },
  recordButtonText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  headerIconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  searchDictionaryCoachmark: { position: "absolute", top: 45, right: 1, minWidth: 122, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.ink, alignItems: "center", shadowColor: "#000000", shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  searchDictionaryCoachmarkText: { color: theme.colors.onInk, fontSize: 12, lineHeight: 17, fontWeight: "500" },
  searchDictionaryCoachmarkArrow: { position: "absolute", top: -5, right: 16, width: 10, height: 10, backgroundColor: theme.colors.ink, transform: [{ rotate: "45deg" }] },
  headerAssistantUnavailable: { opacity: 0.42 },
  libraryMenuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.12)" },
  libraryMenuPanel: { position: "absolute", alignSelf: "center", width: 300, borderRadius: 18, backgroundColor: theme.colors.surface, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  displayMenuPanel: { position: "absolute", right: 16, width: 264, ...theme.shadow.menu },
  displayMenuInner: { padding: 14, gap: 8 },
  displayMenuLabel: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.4, marginTop: 2 },
  displayMenuSegment: { flexDirection: "row", gap: 6 },
  displayMenuOption: { flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: theme.colors.fill2, flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center" },
  displayMenuOptionOn: { backgroundColor: theme.colors.accent },
  displayMenuOptionText: { color: theme.colors.text, fontSize: 14 },
  displayMenuOptionTextOn: { color: theme.colors.onAccent, fontWeight: "600" },
  displayMenuWrap: { flexWrap: "wrap" },
  displayMenuChip: { flex: 0, flexGrow: 1, minWidth: 64, paddingHorizontal: 10 },
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
  searchSubmit: { minWidth: 58, height: 38, paddingHorizontal: 11, borderRadius: 10, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  searchSubmitText: { color: theme.colors.surface, fontSize: 13, fontWeight: "600" },
  libraryList: { flex: 1, backgroundColor: theme.colors.feed },
  list: { paddingHorizontal: theme.gutter, paddingTop: 6, paddingBottom: 120 },
  todayList: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 120 },
  todayCard: { marginBottom: 12 },
  todayCardInner: { overflow: "hidden" },
  todayCover: { width: "100%", backgroundColor: theme.colors.surfaceMuted },
  todayBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 6 },
  todayTitle: { color: theme.colors.text, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  todayPreview: { color: theme.colors.textStrong, fontSize: 15, lineHeight: 23 },
  todayFooter: { marginTop: 2, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  todayTime: { color: theme.colors.textMuted, fontSize: 12 },
  gridHeader: { paddingHorizontal: 3.5 },
  gridList: { paddingHorizontal: 6, paddingTop: 8, paddingBottom: 120 },
  recallShortcuts: { marginHorizontal: 22, marginBottom: 8, paddingVertical: 6, flexDirection: "row", gap: 7 },
  recallShortcut: { flex: 1, minHeight: 44, paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 11, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  memoryRoundBanner: { marginTop: 0, marginBottom: 8 },
  memoryRoundBannerInner: { minHeight: 56, paddingLeft: 12, paddingRight: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  memoryRoundBannerTitle: { flex: 1, color: theme.colors.text, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  recallShortcutTitle: { color: theme.colors.text, fontSize: 12, fontWeight: "500" },
  batchActionBar: { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: 64, paddingTop: 8, paddingHorizontal: 62, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: "row", justifyContent: "space-between" },
  batchActionBarCentered: { justifyContent: "center" },
  batchAction: { minWidth: 72, minHeight: 46, alignItems: "center", justifyContent: "center", gap: 2 },
  batchActionText: { color: theme.colors.text, fontSize: 11 },
  loader: { marginVertical: 32 },
  loadMoreIndicator: { marginVertical: 20 },
  searchSummary: { marginBottom: 10, color: theme.colors.textMuted, fontSize: 12 },
  searchOverlay: { ...StyleSheet.absoluteFill, zIndex: 50, backgroundColor: theme.colors.canvas },
  searchPage: { flex: 1, backgroundColor: theme.colors.canvas },
  searchPageHeader: { minHeight: 62, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchBackButton: { width: 34, height: 42, alignItems: "flex-start", justifyContent: "center" },
  searchBox: { flex: 1, height: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 8 },
  searchPageInput: { flex: 1, height: 44, paddingVertical: 0, color: theme.colors.text, fontSize: 15 },
  searchPageSubmit: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.ink, alignItems: "center", justifyContent: "center" },
  searchPageSubmitDisabled: { opacity: 0.35 },
  searchFilters: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  searchCapabilities: { paddingLeft: 54, paddingRight: 20, paddingTop: 6, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  searchFilterContent: { paddingLeft: 54, paddingRight: 20, paddingTop: 5, paddingBottom: 13, gap: 8 },
  searchFilterChip: { maxWidth: 180, height: 34, paddingHorizontal: 11, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: 17, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  searchFilterChipActive: { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surfaceMuted },
  searchFilterText: { color: theme.colors.textSecondary, fontSize: 12 },
  searchFilterTextActive: { color: theme.colors.text, fontWeight: "600" },
  searchResultsContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 60 },
  searchSectionTitle: { marginBottom: 5, color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  searchStart: { paddingTop: 90, alignItems: "center", gap: 12 },
  searchStartText: { color: theme.colors.textMuted, fontSize: 13 },
  searchEmptyHint: { marginTop: 22, color: theme.colors.textMuted, textAlign: "center", fontSize: 13 },
  searchResultCard: { width: "100%", paddingVertical: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  searchResultMeta: { marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 7 },
  searchResultBody: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchResultDate: { marginLeft: "auto", color: theme.colors.textMuted, fontSize: 11 },
  matchField: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: theme.radius.pill, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted, color: theme.colors.textSecondary, fontSize: 10, fontWeight: "600" },
  matchVariant: { color: theme.colors.textMuted, fontSize: 11 },
  matchSentence: { flex: 1, color: theme.colors.text, fontSize: 16, lineHeight: 24 },
  searchHighlight: { color: theme.colors.text, backgroundColor: theme.colors.warning, fontWeight: "600" },
  searchMatchLabel: { marginRight: 8, color: theme.colors.textMuted, fontSize: 10 },
  searchResultOriginal: { marginTop: 8, color: theme.colors.textMuted, fontSize: 12, lineHeight: 18 },
  emptyCard: { marginTop: 32, paddingVertical: 48, paddingHorizontal: 18, alignItems: "center" },
  emptyTitle: { color: theme.colors.text, textAlign: "center", ...theme.type.heading },
  emptyText: { maxWidth: 280, marginTop: 8, color: theme.colors.textMuted, textAlign: "center", ...theme.type.subhead },
  emptyMascot: { marginBottom: 18 },
  emptyAction: { marginTop: 24 },
  emptyActionInner: { minHeight: 46, paddingHorizontal: 26, alignItems: "center", justifyContent: "center" },
  emptyActionText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "700" },
  card: { width: "100%", paddingVertical: 17, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  cardSelected: { backgroundColor: theme.colors.surfaceSunken },
  cardSelectionIcon: { width: 28, alignItems: "flex-start", justifyContent: "center" },
  cardFooter: { marginTop: 12, minHeight: 22, flexDirection: "row", alignItems: "center" },
  cardTime: { flex: 1, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16, fontWeight: "400", letterSpacing: 0.1 },
  cardCollection: { maxWidth: 100, marginRight: 6, color: theme.colors.textMuted, fontSize: 11, lineHeight: 16 },
  cardMoreButton: { width: 32, height: 24, alignItems: "flex-end", justifyContent: "center" },
  recordActionLayer: { ...StyleSheet.absoluteFill, zIndex: 80 },
  recordActionMenu: { position: "absolute", width: 128, paddingVertical: 2, borderRadius: 8, backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  recordActionItem: { height: 40, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  recordActionText: { color: theme.colors.text, fontSize: 13, fontWeight: "500" },
  recordActionDanger: { color: theme.colors.danger },
  recordActionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: theme.colors.border },
  sampleBadge: { marginRight: 8, color: theme.colors.textMuted, fontSize: 10 },
  cardContent: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 14 },
  cardTextColumn: { flex: 1, minWidth: 0, alignSelf: "stretch", justifyContent: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 17, lineHeight: 23, fontWeight: "600" },
  thumbnailFrame: { width: 108, height: 72, flexShrink: 0, borderRadius: 9, overflow: "hidden", backgroundColor: theme.colors.surfaceMuted },
  thumbnail: { width: "100%", height: "100%", backgroundColor: theme.colors.surfaceMuted },
  originalText: { marginTop: 4, color: theme.colors.textSecondary, fontFamily: editorialFont, fontSize: 13, lineHeight: 19, fontWeight: "400", letterSpacing: 0.02 },
  divider: { marginVertical: 10, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  rewrittenText: { color: theme.colors.text, fontSize: 17, lineHeight: 25, fontWeight: "400" },
  cardDate: { marginTop: 9, color: theme.colors.textMuted, fontSize: 11 },
  processingText: { marginTop: 6, color: theme.colors.textMuted, fontSize: 11, lineHeight: 17 },
  unifiedComposerDock: { position: "absolute", left: 18, right: 18 },
  memoryEntryDock: { position: "absolute", left: 24, right: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 6, paddingHorizontal: 10, ...theme.shadow.float },
  memoryPhotoShortcut: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", gap: 3 },
  memoryPhotoShortcutPressed: { opacity: 0.55 },
  memoryEntryLabel: { fontSize: 11, lineHeight: 14, color: theme.colors.textSecondary, textAlign: "center", fontWeight: "500" },
  memoryEntryButton: { width: 52, height: 38, alignItems: "center", justifyContent: "center" },
  memoryDraftDot: { position: "absolute", top: 4, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.danger },
  memoryCollapseInput: { alignSelf: "center", width: 44, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface, marginBottom: 6 },
  inspirationCard: { position: "absolute", left: 0, right: 0, bottom: 62, zIndex: 4, minHeight: 64, paddingLeft: 12, paddingRight: 10, paddingVertical: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.borderStrong, borderRadius: 18, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 9, shadowColor: "#000000", shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  inspirationOrb: { position: "absolute", right: 8, bottom: 62, zIndex: 3, width: 40, height: 40, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.borderStrong, borderRadius: 20, backgroundColor: "rgba(234,246,241,0.98)", alignItems: "center", justifyContent: "center", shadowColor: "#000000", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  inspirationPrompt: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
  inspirationCopy: { flex: 1, minWidth: 0 },
  inspirationName: { color: theme.colors.success, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  inspirationQuestion: { marginTop: 1, color: theme.colors.text, fontSize: 14, lineHeight: 19, fontWeight: "500" },
  inspirationActions: { flexDirection: "row", alignItems: "center", gap: 3 },
  inspirationAction: { minHeight: 32, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 3 },
  inspirationActionText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  inspirationAssistant: { width: 34, height: 34, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.borderStrong, borderRadius: 17, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  unifiedComposerBar: { minHeight: 60, padding: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.borderStrong, borderRadius: 26, backgroundColor: theme.colors.surface, gap: 6, shadowColor: "#000000", shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 9 },
  quickNoteAddMenu: { flexDirection: "row", gap: 10, paddingHorizontal: 6, paddingVertical: 6 },
  quickNoteAddMenuItem: { flex: 1, minHeight: 44, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: theme.colors.surfaceMuted },
  quickNoteAddMenuText: { fontSize: 13, color: theme.colors.textSecondary, flexShrink: 1 },
  unifiedComposerControls: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  unifiedComposerLeftRail: { alignSelf: "stretch", width: 36, alignItems: "center" },
  unifiedComposerRightRail: { flexDirection: "row", alignItems: "center", gap: 3 },
  inspirationToolbarButton: { position: "relative", width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  inspirationToolbarButtonActive: { backgroundColor: theme.colors.surfaceMuted },
  inspirationToolbarDot: { position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.danger, borderWidth: 1, borderColor: theme.colors.surface },
  unifiedComposerRailSpacer: { flex: 1 },
  unifiedComposerInputArea: { flex: 1, paddingLeft: 10, paddingRight: 8, borderRadius: 17, backgroundColor: theme.colors.surfaceMuted, overflow: "hidden" },
  unifiedComposerMeasureText: { position: "absolute", left: 10, right: 13, top: 10, opacity: 0, color: "transparent", fontSize: 17, lineHeight: 24 },
  unifiedComposerInputAreaTwoLines: { height: 58, alignItems: "stretch" },
  unifiedComposerControlsMultiline: { alignItems: "stretch" },
  unifiedComposerInput: { flex: 1, minHeight: 40, maxHeight: 96, paddingHorizontal: 5, borderRadius: 20, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 4 },
  unifiedComposerInputMultiline: { position: "relative", minHeight: 126, maxHeight: 220, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 7, borderRadius: 22, backgroundColor: "transparent", flexDirection: "column", alignItems: "stretch", gap: 4 },
  unifiedComposerAdd: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  unifiedComposerMedia: { width: 28, height: 30, alignItems: "center", justifyContent: "center" },
  unifiedComposerExpand: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  fullEditorIcon: { position: "relative", width: 17, height: 17 },
  fullEditorIconTopLeft: { position: "absolute", top: 1, left: 1, width: 8, height: 8, borderTopWidth: 2, borderLeftWidth: 2, borderColor: theme.colors.textSecondary, borderTopLeftRadius: 1 },
  fullEditorIconBottomRight: { position: "absolute", right: 1, bottom: 1, width: 8, height: 8, borderRightWidth: 2, borderBottomWidth: 2, borderColor: theme.colors.textSecondary, borderBottomRightRadius: 1 },
  unifiedComposerCompactExpand: { width: 30, height: 30, flexShrink: 0, borderRadius: 15, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  unifiedComposerTextInput: { width: "100%", height: "100%", paddingVertical: 10, paddingRight: 6, color: theme.colors.text, fontSize: 17, lineHeight: 24 },
  // Android applies explicit lineHeight spans to text but not the empty hint/cursor.
  // Keep native font metrics identical before and after typing the first character.
  unifiedComposerTextInputAndroid: { lineHeight: undefined, includeFontPadding: false },
  unifiedComposerTextInputTwoLines: { height: 58, paddingTop: 8, paddingBottom: 8, paddingRight: 38 },
  unifiedComposerCollapse: { position: "absolute", top: 9, right: 9, zIndex: 2, width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  unifiedComposerToolbar: { minHeight: 40, paddingHorizontal: 5, flexDirection: "row", alignItems: "center", gap: 5 },
  unifiedComposerTool: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  unifiedComposerToolbarSpacer: { flex: 1 },
  unifiedComposerMic: { width: 38, height: 38, borderRadius: 19, flexShrink: 0 },
  unifiedComposerSend: { width: 28, height: 28, marginHorizontal: 5, marginVertical: 6, borderRadius: 14, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  unifiedComposerSendDisabled: { backgroundColor: theme.colors.disabled },
  quickNoteAddMenuDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14, backgroundColor: theme.colors.border },
  quickNoteAttachmentRow: { paddingHorizontal: 7, paddingTop: 5, paddingBottom: 2, gap: 8 },
  imageDescriptionChoice: { alignSelf: "flex-end", flexDirection: "row", gap: 6, minHeight: 30, marginHorizontal: 7, paddingHorizontal: 10, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  imageDescriptionChoiceActive: { borderColor: "rgba(82,121,108,0.28)", backgroundColor: theme.colors.accentSoft },
  imageDescriptionChoicePressed: { opacity: 0.58 },
  imageDescriptionChoiceText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "500" },
  imageDescriptionChoiceTextActive: { color: theme.colors.success },
  quickNoteAttachment: { width: 66, height: 66, borderRadius: 13, overflow: "visible", backgroundColor: theme.colors.surfaceMuted },
  quickNoteAttachmentImage: { width: 66, height: 66, borderRadius: 13 },
  quickNoteAttachmentOverlay: { ...StyleSheet.absoluteFill, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.34)" },
  quickNoteAttachmentPreparing: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
  quickNoteAttachmentRemove: { position: "absolute", top: -5, right: -5, width: 21, height: 21, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(27,31,30,0.82)", borderWidth: 2, borderColor: theme.colors.surface },
  modalPage: { flex: 1, backgroundColor: theme.colors.canvas },
  composerTransitionPage: { flex: 1, backgroundColor: theme.colors.canvas },
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
  collectionManagerRowSelected: { backgroundColor: theme.colors.surfaceSunken },
  collectionRowName: { flex: 1, color: theme.colors.text, fontSize: 15 },
  sidebarOverlay: { ...StyleSheet.absoluteFill, zIndex: 100, elevation: 20 },
  sidebarAnimatedContent: { position: "absolute", top: 0, bottom: 0, left: 0, width: "84%", maxWidth: 360, zIndex: 2 },
  sidebarAnimatedScrim: { ...StyleSheet.absoluteFill, zIndex: 1, backgroundColor: "rgba(0, 0, 0, 0.24)" },
  sidebar: { flex: 1, width: "100%", backgroundColor: theme.colors.surface, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: theme.colors.borderStrong, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 6, height: 0 }, elevation: 10 },
  sidebarHeader: { minHeight: 66, paddingLeft: 20, paddingRight: 12, flexDirection: "row", alignItems: "center" },
  sidebarAccount: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center" },
  sidebarAvatar: { width: 38, height: 38, borderRadius: 19, overflow: "hidden", borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" },
  sidebarAvatarImage: { width: 38, height: 38, borderRadius: 19 },
  sidebarAccountText: { flex: 1, minWidth: 0, marginLeft: 11 },
  sidebarAccountNameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  sidebarAccountName: { flexShrink: 1, color: theme.colors.text, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  sidebarMembershipBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: theme.colors.highlight },
  sidebarMembershipBadgeText: { color: theme.colors.warning, fontSize: 9, lineHeight: 12, fontWeight: "700", letterSpacing: 0.3 },
  sidebarSettingsButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sidebarFixedContent: { paddingHorizontal: 10 },
  sidebarCollectionSection: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  sidebarCollectionScroller: { flex: 1 },
  sidebarCollectionContent: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 24 },
  sidebarSortableCollection: { width: "100%" },
  sidebarRow: { position: "relative", minHeight: 46, paddingHorizontal: 12, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 11 },
  sidebarRowMuted: { opacity: 0.42 },
  sidebarLeadingMuted: { opacity: 0.55 },
  sidebarDisclosure: { width: 16, height: 32, marginRight: -7, alignItems: "center", justifyContent: "center" },
  sidebarRowSelected: { backgroundColor: theme.colors.surfaceMuted },
  sidebarSelectionMark: { position: "absolute", left: 0, top: 10, bottom: 10, width: 2, borderRadius: 1, backgroundColor: theme.colors.ink },
  sidebarRowLabel: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 15, lineHeight: 21, fontWeight: "400", zIndex: 0 },
  sidebarRowLabelMuted: { color: theme.colors.textMuted },
  sidebarRowLabelSelected: { color: theme.colors.text },
  sidebarRowCount: { minWidth: 24, color: theme.colors.textMuted, fontSize: 12, textAlign: "right" },
  sidebarRowFavorite: { width: 28, height: 34, marginHorizontal: -4, zIndex: 2, elevation: 2, alignItems: "center", justifyContent: "center" },
  sidebarRowAction: { width: 28, height: 34, marginHorizontal: -5, zIndex: 2, elevation: 2, alignItems: "center", justifyContent: "center" },
  collectionActionBackdrop: { ...StyleSheet.absoluteFill, zIndex: 20, elevation: 20 },
  collectionActionMenu: { position: "absolute", width: 132, paddingVertical: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  collectionActionRow: { minHeight: 42, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  collectionActionText: { flex: 1, color: theme.colors.text, fontSize: 14, lineHeight: 20 },
  collectionActionDanger: { color: theme.colors.danger },
  collectionActionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 8, backgroundColor: theme.colors.border },
  sidebarSectionHeader: { minHeight: 46, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sidebarLifeSectionHeader: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  sidebarSectionHeaderSelected: { borderRadius: 6, backgroundColor: theme.colors.surfaceMuted },
  sidebarSectionToggle: { minHeight: 46, flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  sidebarSectionDisclosureButton: { width: 22, minHeight: 46, alignItems: "flex-start", justifyContent: "center" },
  sidebarSectionSelect: { flex: 1, minHeight: 46, justifyContent: "center" },
  sidebarSectionTitle: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 21, fontWeight: "400" },
  sidebarSectionTitleSelected: { color: theme.colors.text },
  sidebarSectionActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  sidebarSectionAction: { width: 34, height: 36, alignItems: "center", justifyContent: "center" },
  sidebarCreateRow: { minHeight: 46, marginHorizontal: 6, marginBottom: 4, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.borderStrong, flexDirection: "row", alignItems: "center", gap: 10 },
  sidebarCreateInput: { flex: 1, minHeight: 42, paddingVertical: 0, color: theme.colors.text, fontSize: 15 },
  sidebarEmpty: { paddingHorizontal: 14, paddingVertical: 12, color: theme.colors.textMuted, fontSize: 13, lineHeight: 20 },
}));

/** Put cards created this session first, keeping the fetched order for the rest. */
function pinNewRecords(incoming: CardRecordSummary[], previous: CardRecordSummary[], pinnedIds: string[]): CardRecordSummary[] {
  if (!pinnedIds.length) return incoming;
  const byId = new Map([...previous, ...incoming].map((record) => [record.id, record]));
  const fetched = new Map(incoming.map((record) => [record.id, record]));
  const pinned = pinnedIds.flatMap((id) => {
    const record = fetched.get(id) ?? byId.get(id);
    return record ? [record] : [];
  });
  const pinnedSet = new Set(pinned.map((record) => record.id));
  return [...pinned, ...incoming.filter((record) => !pinnedSet.has(record.id))];
}

/** The closest earlier day (within ~6 months) that has cards, for endless 今日 browsing. */
async function previousDayWithCards(dateKey: string): Promise<string | null> {
  const day = new Date(`${dateKey}T12:00:00`);
  const before = new Date(day); before.setDate(before.getDate() - 1);
  const from = new Date(day); from.setDate(from.getDate() - 180);
  const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const keys = await getCardDateKeys(key(from), key(before)).catch(() => [] as string[]);
  return [...keys].sort().pop() ?? null;
}

type HomeLayout = "grid" | "waterfall" | "list";
