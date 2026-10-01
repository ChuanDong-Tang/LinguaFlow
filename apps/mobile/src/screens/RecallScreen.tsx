import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getLanguage, t, tf } from "../i18n";
import { logEvent } from "../services/logger";
import {
  createRecallSessionFromRecords,
  finishRecallSession,
  getActiveRecallSession,
  resumeRecallSession,
  CardApiError,
  getCardDateKeys,
  getCardRecord,
  getCardRecords,
  removeCardRecordImageById,
  searchRecallCards,
  updateCardContent,
  updateRecallNode,
  type CardRecordDetail,
  type CardRecordSummary,
  type RecallSession,
} from "../services/api/cardApi";
import { theme } from "../theme";
import { CardCalendarScreen } from "./CardCalendarScreen";
import { CardDetailModal } from "./CardDetailModal";
import { generateMissingCardContent, hasGeneratedContent, type CardGenerationTarget } from "../services/card/cardContentGeneration";
import { getCardGenerationState, subscribeCardGenerationState } from "../services/card/cardGenerationState";
import { recallResumeIndex, readRecallBookmark } from "../services/card/recallProgress";
import {
  isTimeCapsuleQuery,
  mergeTimeCapsuleRecords,
  recallTimeCapsuleAnchors,
  restoreTimeCapsuleRecordOrder,
  timeCapsuleQuery,
  type RecallTimeCapsuleAnchor,
} from "../services/card/recallTimeCapsule";

type Stage = "home" | "deck" | "summary";
const recallPositionKey = (sessionId: string): string => `linguaflow.recall.position.v1:${sessionId}`;

export function RecallScreen({ isActive, onOpenLibrary, onEditCard, onCardChanged, onOpenMemoryRound, memoryRoundResumeAvailable, refreshRevision = 0, launchRequest = null }: { isActive: boolean; onOpenLibrary: () => void; onEditCard: (recordId: string) => void; onCardChanged: () => void; onOpenMemoryRound: () => void; memoryRoundResumeAvailable: boolean; refreshRevision?: number; launchRequest?: { key: number; mode: "today" | "yesterday" | "recent" | "blind" } | null }) {
  const [stage, setStage] = useState<Stage>("home");
  const [loading, setLoading] = useState(false);
  const [todayCards, setTodayCards] = useState<CardRecordSummary[]>([]);
  const [yesterdayCards, setYesterdayCards] = useState<CardRecordSummary[]>([]);
  const [dateKeys, setDateKeys] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<RecallSession | null>(null);
  const [session, setSession] = useState<RecallSession | null>(null);
  const [cards, setCards] = useState<Record<string, CardRecordDetail>>({});
  const [pendingGenerationTargets, setPendingGenerationTargets] = useState<CardGenerationTarget[]>([]);
  const [failedGenerationTargets, setFailedGenerationTargets] = useState<CardGenerationTarget[]>([]);
  const [retryingGenerationTarget, setRetryingGenerationTarget] = useState<CardGenerationTarget | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState({ cards: 0, attempted: 0, correct: 0 });
  const [completedTimeCapsule, setCompletedTimeCapsule] = useState(false);
  const [timeCapsuleAnchorByRecordId, setTimeCapsuleAnchorByRecordId] = useState<Record<string, RecallTimeCapsuleAnchor>>({});
  const [finishing, setFinishing] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [topicVisible, setTopicVisible] = useState(false);
  const [topic, setTopic] = useState("");
  const [topicSearchState, setTopicSearchState] = useState<"idle" | "searching" | "empty">("idle");
  const [directLaunchPending, setDirectLaunchPending] = useState(Boolean(launchRequest));
  const handledLaunchRef = useRef<number | null>(null);
  const progressQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const bookmarkQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!isActive || stage !== "deck") return;
    const recordId = session?.nodes[currentIndex]?.recordId;
    if (!recordId) return;
    let active = true;
    void Promise.all([getCardRecord(recordId), getCardGenerationState(recordId)]).then(([detail, generationState]) => {
      if (!active) return;
      setCards((current) => ({ ...current, [recordId]: detail }));
      setPendingGenerationTargets((generationState?.pendingTargets ?? []).filter((target) => !hasGeneratedContent(detail, target)));
      setFailedGenerationTargets((generationState?.failedTargets ?? []).filter((target) => !hasGeneratedContent(detail, target)));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [refreshRevision, isActive, stage, session?.id, currentIndex]);

  useEffect(() => subscribeCardGenerationState((recordId, state) => {
    if (stage !== "deck" || session?.nodes[currentIndex]?.recordId !== recordId) return;
    setPendingGenerationTargets(state?.pendingTargets ?? []);
    setFailedGenerationTargets(state?.failedTargets ?? []);
  }), [stage, session?.id, currentIndex]);

  useEffect(() => {
    if (!launchRequest || handledLaunchRef.current === launchRequest.key) return;
    setDirectLaunchPending(true);
  }, [launchRequest?.key]);

  const loadHome = useCallback(async () => {
    setLoading(true);
    try {
      const today = localDateKey(new Date());
      const yesterday = localDateKey(new Date(Date.now() - 86_400_000));
      await progressQueueRef.current.catch(() => undefined);
      const [todayRows, yesterdayRows, keys, active] = await Promise.all([
        getCardRecords({ dateKey: today, limit: 50 }),
        getCardRecords({ dateKey: yesterday, limit: 50 }),
        getCardDateKeys("2000-01-01", today),
        getActiveRecallSession(),
      ]);
      const completedTodayRows = completedCards(todayRows);
      const completedYesterdayRows = completedCards(yesterdayRows);
      const resumableActive = active?.nodes.length && !isRecentRecallSession(active) && !isBlindRecallSession(active) && !isTimeCapsuleRecallSession(active)
        ? active
        : null;
      const validKeys = [...keys].sort();
      setTodayCards(completedTodayRows);
      setYesterdayCards(completedYesterdayRows);
      setDateKeys(validKeys);
      setActiveSession(resumableActive);
      if (launchRequest && handledLaunchRef.current !== launchRequest.key) {
        handledLaunchRef.current = launchRequest.key;
        if (launchRequest.mode === "blind") {
          const started = await beginTimeCapsule();
          setDirectLaunchPending(false);
          if (!started) onOpenLibrary();
          return;
        }
        else {
          const rows = launchRequest.mode === "today"
            ? completedTodayRows
            : launchRequest.mode === "yesterday"
              ? completedYesterdayRows
              : [...completedYesterdayRows, ...completedTodayRows]
                .sort((left, right) => Date.parse(left.recordedAt ?? left.createdAt) - Date.parse(right.recordedAt ?? right.createdAt));
          if (!rows.length) {
            setDirectLaunchPending(false);
            Alert.alert(t("recall.error.empty"));
            onOpenLibrary();
            return;
          }
          const query = launchRequest.mode === "today" ? today : launchRequest.mode === "yesterday" ? yesterday : `recent:${yesterday}:${today}`;
          await beginRecords(rows.map((row) => row.id), query);
          setDirectLaunchPending(false);
        }
      }
    } catch {
      handledLaunchRef.current = null;
      setDirectLaunchPending(false);
      Alert.alert(t("recall.error.load"));
      if (launchRequest) onOpenLibrary();
    } finally {
      setLoading(false);
    }
  }, [launchRequest?.key]);

  useEffect(() => { if (isActive && stage === "home") void loadHome(); }, [isActive, stage, loadHome]);

  async function hydrate(value: RecallSession): Promise<Record<string, CardRecordDetail>> {
    const rows = await Promise.all(value.nodes.map(async (node) => {
      try { return [node.recordId, await getCardRecord(node.recordId)] as const; }
      catch (error) {
        if (error instanceof CardApiError && error.status === 404) return null;
        throw error;
      }
    }));
    return Object.fromEntries(rows.filter((row): row is NonNullable<typeof row> => Boolean(row)));
  }

  async function openSession(value: RecallSession, resume = false): Promise<void> {
    if (!value.nodes.length) throw new Error("Recall session has no cards");
    const hydratedCards = await hydrate(value);
    const availableRecordIds = new Set(Object.keys(hydratedCards));
    const availableSession = filterAvailableRecallSession(value, availableRecordIds);
    if (!availableSession.nodes.length) throw new CardApiError("RECALL_NO_AVAILABLE_CARDS", "Recall session has no available cards", 404);
    const saved = resume ? await AsyncStorage.getItem(recallPositionKey(value.id)).catch(() => null) : null;
    const savedNodeId = readRecallBookmark(saved, value.lastOpenedAt);
    const initialIndex = resume ? recallResumeIndex(availableSession.nodes, savedNodeId) : 0;
    const node = availableSession.nodes[initialIndex]!;
    if (resume && value.status === "paused") await resumeRecallSession(value.id);
    await AsyncStorage.setItem(recallPositionKey(value.id), JSON.stringify({ nodeId: node.id, savedAt: Date.now() }));
    setCards(hydratedCards);
    setCompletedTimeCapsule(isTimeCapsuleRecallSession(value));
    setSession(availableSession);
    setAttempts({});
    setCurrentIndex(initialIndex);
    setStage("deck");
    queueProgress(value.id, node.id);
  }

  async function beginRecords(recordIds: string[], query?: string, timeCapsuleAnchors?: Record<string, RecallTimeCapsuleAnchor>): Promise<boolean> {
    const uniqueIds = [...new Set(recordIds)].slice(0, 50);
    if (!uniqueIds.length) {
      Alert.alert(t("recall.error.empty"));
      return false;
    }
    setLoading(true);
    try {
      const created = await createRecallSessionFromRecords(uniqueIds, query);
      const orderedSession = isTimeCapsuleQuery(query)
        ? { ...created, nodes: restoreTimeCapsuleRecordOrder(created.nodes, uniqueIds) }
        : created;
      setCompletedTimeCapsule(isTimeCapsuleQuery(query));
      setTimeCapsuleAnchorByRecordId(timeCapsuleAnchors ?? {});
      await openSession(orderedSession);
      return true;
    } catch (error) {
      setTimeCapsuleAnchorByRecordId({});
      void logEvent("recall_session_start_failed", "error", error instanceof Error ? error.message : String(error), {
        cardCount: uniqueIds.length,
        source: isTimeCapsuleQuery(query) ? "time_capsule" : "records",
      }).catch(() => undefined);
      Alert.alert(t("recall.error.start_title"), t("recall.error.retry"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function resume(value = activeSession): Promise<void> {
    if (!value || loading) return;
    setLoading(true);
    try {
      setCompletedTimeCapsule(false);
      setTimeCapsuleAnchorByRecordId({});
      await openSession(value, true);
    }
    catch (error) {
      if (error instanceof CardApiError && error.code === "RECALL_NO_AVAILABLE_CARDS") {
        setActiveSession(null);
        Alert.alert(t("recall.error.empty"));
      } else Alert.alert(t("recall.error.load"));
    }
    finally { setLoading(false); }
  }

  async function beginSelectedDate(date: Date): Promise<void> {
    const key = localDateKey(date);
    setDatePickerVisible(false);
    setLoading(true);
    try {
      const rows = completedCards(await getCardRecords({ dateKey: key, limit: 200 }));
      await beginRecords(rows.map((row) => row.id), key);
    } catch {
      Alert.alert(t("recall.error.load"));
    } finally {
      setLoading(false);
    }
  }

  async function beginTopic(): Promise<void> {
    const query = topic.trim();
    if (!query) return;
    setTopicSearchState("searching");
    try {
      const results = await searchRecallCards({ q: query });
      if (!results.length) {
        setTopicSearchState("empty");
        return;
      }
      setTopicVisible(false);
      setTopicSearchState("idle");
      await beginRecords(results.map((item) => item.recordId), query);
    } catch {
      setTopicSearchState("idle");
      Alert.alert(t("recall.error.search"));
    }
  }

  async function beginTimeCapsule(): Promise<boolean> {
    const now = new Date();
    const anchors = recallTimeCapsuleAnchors(now);
    setLoading(true);
    try {
      const groups = await Promise.all(anchors.map(async (anchor) => ({
        anchor,
        records: completedCards(await getCardRecords({ dateKey: anchor.dateKey, limit: 200 })),
      })));
      const merged = mergeTimeCapsuleRecords(groups, 50);
      if (!merged.records.length) {
        Alert.alert(t("recall.error.empty"));
        return false;
      }
      return await beginRecords(merged.records.map((record) => record.id), timeCapsuleQuery(now), merged.anchorByRecordId);
    } catch (error) {
      void logEvent("recall_blind_box_start_failed", "error", error instanceof Error ? error.message : String(error), {
        anchorCount: anchors.length,
      }).catch(() => undefined);
      Alert.alert(t("recall.error.start_title"), t("recall.error.retry"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  function navigateDeck(nextIndex: number): void {
    if (!session || finishing || leavingRef.current || nextIndex < 0 || nextIndex >= session.nodes.length || nextIndex === currentIndex) return;
    const current = session.nodes[currentIndex];
    const next = session.nodes[nextIndex];
    setCurrentIndex(nextIndex);
    if (current && next) queueProgress(session.id, next.id, current.id);
  }

  function queueProgress(sessionId: string, nodeId: string, previousId?: string): void {
    const bookmark = JSON.stringify({ nodeId, savedAt: Date.now() });
    const saved = bookmarkQueueRef.current.catch(() => undefined).then(() => AsyncStorage.setItem(recallPositionKey(sessionId), bookmark));
    bookmarkQueueRef.current = saved;
    void saved.catch(() => undefined);
    progressQueueRef.current = progressQueueRef.current.catch(() => undefined).then(async () => {
      await saved;
      if (previousId) await updateRecallNode(sessionId, previousId, "completed");
      await updateRecallNode(sessionId, nodeId, "current");
    });
    // Keep the rejection available to exit/finish, without an unhandled rejection.
    void progressQueueRef.current.catch(() => undefined);
  }

  async function leaveDeck(): Promise<void> {
    if (leavingRef.current || finishing) return;
    leavingRef.current = true;
    try {
      await progressQueueRef.current;
    } catch {
      // Retry the actual visible card, not a stale navigation response.
      try {
        const node = session?.nodes[currentIndex];
        if (session && node) await updateRecallNode(session.id, node.id, "current");
      } catch {
        Alert.alert(t("recall.error.load"));
        leavingRef.current = false;
        return;
      }
    }
    leavingRef.current = false;
    setStage("home");
    setSession(null);
    setCards({});
    if (launchRequest) {
      onOpenLibrary();
      return;
    }
  }

  function finishSummary(): void {
    setSession(null);
    setCards({});
    setTimeCapsuleAnchorByRecordId({});
    if (launchRequest) {
      onOpenLibrary();
      return;
    }
    setStage("home");
  }

  async function finish(): Promise<void> {
    if (!session || finishing) return;
    setFinishing(true);
    try {
      await progressQueueRef.current.catch(() => undefined);
      const current = session.nodes[currentIndex];
      if (current) await updateRecallNode(session.id, current.id, "completed");
      await finishRecallSession(session.id);
      await AsyncStorage.removeItem(recallPositionKey(session.id)).catch(() => undefined);
      const values = Object.values(attempts);
      setSummary({ cards: session.nodes.length, attempted: values.length, correct: values.filter(Boolean).length });
      setActiveSession(null);
      setStage("summary");
    } catch {
      Alert.alert(t("recall.error.finish"));
    } finally {
      setFinishing(false);
    }
  }

  const currentNode = session?.nodes[currentIndex];
  const currentDetail = currentNode ? cards[currentNode.recordId] ?? null : null;
  const currentTimeCapsuleAnchor = currentNode ? timeCapsuleAnchorByRecordId[currentNode.recordId] : undefined;
  const previousTimeCapsuleAnchor = currentIndex > 0
    ? timeCapsuleAnchorByRecordId[session?.nodes[currentIndex - 1]?.recordId ?? ""]
    : undefined;
  const nextTimeCapsuleAnchor = session && currentIndex < session.nodes.length - 1
    ? timeCapsuleAnchorByRecordId[session.nodes[currentIndex + 1]?.recordId ?? ""]
    : undefined;
  function confirmRemoveCurrentImage(imageId?: string): void {
    if (!currentDetail) return;
    const images = currentDetail.images ?? [];
    const image = images.find((candidate) => candidate.id === imageId) ?? images[0] ?? currentDetail.image;
    if (!image) return;
    const recordId = currentDetail.id;
    Alert.alert(t("card_detail.photo.remove_title"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () => void removeCardRecordImageById(recordId, image.id)
          .then((updated) => {
            setCards((current) => ({ ...current, [recordId]: updated }));
            onCardChanged();
          })
          .catch(() => Alert.alert(t("card_detail.photo.remove_failed_title"), t("card_detail.photo.remove_failed_message"))),
      },
    ]);
  }
  if (stage === "deck" && session && currentNode) return <View style={styles.deckPage}>
    <CardDetailModal
      detail={currentDetail}
      loading={!currentDetail}
      initialTab={hasRecallCloze(currentDetail) ? "cloze" : "review"}
      hideRelations
      hidePhraseRecommendation={isTimeCapsuleRecallSession(session) || session.launchContext?.query?.startsWith("recent:") === true}
      onEditCard={() => onEditCard(currentNode.recordId)}
      onUpdateMetadata={async (input) => {
        if (!currentDetail) return false;
        try {
          const updated = await updateCardContent(currentDetail.id, input);
          setCards((current) => ({ ...current, [currentDetail.id]: updated }));
          onCardChanged();
          return true;
        } catch (error) {
          Alert.alert(t("card_detail.error.save"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
          return false;
        }
      }}
      pendingGenerationTargets={pendingGenerationTargets}
      failedGenerationTargets={failedGenerationTargets}
      retryingGenerationTarget={retryingGenerationTarget}
      onRetryGeneration={(target) => {
        if (!currentDetail || retryingGenerationTarget) return;
        setRetryingGenerationTarget(target);
        setPendingGenerationTargets((current) => [...new Set([...current, target])]);
        setFailedGenerationTargets((current) => current.filter((candidate) => candidate !== target));
        void generateMissingCardContent(currentDetail, [target])
          .then((generation) => {
            setCards((current) => ({ ...current, [currentDetail.id]: generation.detail }));
            setPendingGenerationTargets((current) => current.filter((candidate) => candidate !== target));
            setFailedGenerationTargets((current) => [...new Set([
              ...current.filter((candidate) => candidate !== target),
              ...generation.failedTargets,
            ])]);
            onCardChanged();
          })
          .catch((error) => {
            setPendingGenerationTargets((current) => current.filter((candidate) => candidate !== target));
            setFailedGenerationTargets((current) => [...new Set([...current, target])]);
            Alert.alert(t("card_detail.error.try_again"), error instanceof Error ? error.message : t("card_detail.error.try_again"));
          })
          .finally(() => setRetryingGenerationTarget(null));
      }}
      onRemoveImage={currentDetail && ((currentDetail.images?.length ?? 0) > 0 || currentDetail.image) ? confirmRemoveCurrentImage : undefined}
      onClose={leaveDeck}
      recallPosition={{ index: currentIndex, total: session.nodes.length }}
      recallContextLabel={currentTimeCapsuleAnchor ? timeCapsuleLabel(currentTimeCapsuleAnchor) : undefined}
      recallPreviousContextLabel={previousTimeCapsuleAnchor ? timeCapsuleLabel(previousTimeCapsuleAnchor) : undefined}
      recallNextContextLabel={nextTimeCapsuleAnchor ? timeCapsuleLabel(nextTimeCapsuleAnchor) : undefined}
      recallPreviousDetail={currentIndex > 0 ? cards[session.nodes[currentIndex - 1]!.recordId] ?? null : null}
      recallNextDetail={currentIndex < session.nodes.length - 1 ? cards[session.nodes[currentIndex + 1]!.recordId] ?? null : null}
      onRecallPrevious={currentIndex > 0 ? () => navigateDeck(currentIndex - 1) : undefined}
      onRecallNext={currentIndex < session.nodes.length - 1 ? () => navigateDeck(currentIndex + 1) : undefined}
      onRecallFinish={currentIndex === session.nodes.length - 1 ? () => void finish() : undefined}
      onClozeAttempt={({ recordId, blankId, correct }) => setAttempts((current) => ({ ...current, [`${recordId}:${blankId}`]: current[`${recordId}:${blankId}`] || correct }))}
      onClozeStateChange={({ recordId, contentType, contentVersion, state, version }) => setCards((current) => {
        const card = current[recordId];
        if (!card) return current;
        const contentBlocks = card.contentBlocks.map((block) => block.contentType === contentType && block.contentVersion === contentVersion
          ? {
              ...block,
              practice: {
                hasCloze: state.blanks.length > 0,
                dictationCompleted: block.practice?.dictationCompleted ?? false,
                nextReviewAt: block.practice?.nextReviewAt ?? null,
                clozeState: state,
                clozeVersion: version,
                clozeLastResult: block.practice?.clozeLastResult ?? null,
                dictationLastResult: block.practice?.dictationLastResult ?? null,
              },
            }
          : block);
        return { ...current, [recordId]: { ...card, contentBlocks } };
      })}
    />
    {finishing ? <View style={styles.busyOverlay}><ActivityIndicator size="large" color={theme.colors.text} /></View> : null}
  </View>;

  if (stage === "summary") return <RecallSummary summary={summary} onDone={finishSummary} onAgain={completedTimeCapsule ? () => void beginTimeCapsule() : undefined} loading={loading} />;

  if (directLaunchPending) return <SafeAreaView style={styles.directLaunchPage}><ActivityIndicator size="large" color={theme.colors.text} /></SafeAreaView>;

  return <SafeAreaView style={styles.page}>
    <View style={styles.header}><Pressable accessibilityLabel={t("recall.a11y.back")} style={styles.headerSide} onPress={onOpenLibrary}><Ionicons name="chevron-back" size={25} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{t("recall.title")}</Text><View style={styles.headerSide} /></View>
    <ScrollView contentContainerStyle={styles.home} showsVerticalScrollIndicator={false}>
      <MemoryRoundHero active={isActive} resume={memoryRoundResumeAvailable} onPress={onOpenMemoryRound} />
      {activeSession ? <Pressable style={styles.resume} onPress={() => void resume()}><Text style={styles.resumeText}>{t("recall.resume")}</Text><Ionicons name="arrow-forward" size={18} color={theme.colors.text} /></Pressable> : null}
      <View style={styles.dayRow}>
        <DayCard title={t("recall.today")} count={todayCards.length} onPress={() => void beginRecords(todayCards.map((row) => row.id), localDateKey(new Date()))} />
        <DayCard title={t("recall.yesterday")} count={yesterdayCards.length} onPress={() => void beginRecords(yesterdayCards.map((row) => row.id), localDateKey(new Date(Date.now() - 86_400_000)))} />
      </View>
      <RecallChoice icon="calendar-outline" title={t("recall.select_date")} disabled={!dateKeys.length} onPress={() => setDatePickerVisible(true)} />
      <RecallChoice icon="search-outline" title={t("recall.explore")} disabled={!dateKeys.length} onPress={() => setTopicVisible(true)} />
      <RecallChoice icon="cube-outline" title={t("recall.blind_box")} disabled={loading || !dateKeys.length} onPress={() => void beginTimeCapsule()} />
      {!loading && !dateKeys.length ? <Pressable style={styles.createHint} onPress={onOpenLibrary}><Text style={styles.createHintText}>{t("recall.create_more")}</Text><Ionicons name="add" size={18} color={theme.colors.text} /></Pressable> : null}
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.text} /> : null}
    </ScrollView>
    <CardCalendarScreen visible={datePickerVisible} onClose={() => setDatePickerVisible(false)} onSelectDate={(value) => void beginSelectedDate(dateFromKey(value))} />
    <TopicModal visible={topicVisible} value={topic} searchState={topicSearchState} onChange={(value) => { setTopic(value); setTopicSearchState("idle"); }} onClose={() => { if (topicSearchState !== "searching") { setTopicVisible(false); setTopicSearchState("idle"); } }} onSubmit={() => void beginTopic()} />
  </SafeAreaView>;
}

function MemoryRoundHero({ active, resume, onPress }: { active: boolean; resume: boolean; onPress: () => void }) {
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
        Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
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
  return <Pressable style={styles.memoryHero} onPress={onPress}>
    <View style={styles.memoryHeroTop}><View style={styles.memoryHeroTitleRow}><Text style={styles.memoryHeroTitle}>{t("memory_round.title")}</Text>{resume ? <Text style={styles.memoryResumeBadge}>{t("recall.resume")}</Text> : null}</View><View style={styles.memoryHeroArrow}><Ionicons name="arrow-forward" size={19} color="#49675D" /></View></View>
    <View style={styles.memoryPath}>{["#82CEB7", "#84C4EC", "#F1B587", "#AE98DF"].map((color, index) => <React.Fragment key={color}>{index ? <View style={[styles.memoryConnector, { backgroundColor: `${color}80` }]} /> : null}<Animated.View style={[styles.memoryNode, { backgroundColor: color }, index === 0 && { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.72, 1] }) }]} /></React.Fragment>)}</View>
  </Pressable>;
}

function RecallChoice({ icon, title, subtitle, disabled, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; subtitle?: string; disabled: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} style={[styles.choice, disabled && styles.disabled]} onPress={onPress}><View style={styles.choiceIcon}><Ionicons name={icon} size={20} color={theme.colors.text} /></View><View style={styles.choiceBody}><Text style={styles.choiceText}>{title}</Text>{subtitle ? <Text style={styles.choiceSubtitle}>{subtitle}</Text> : null}</View><Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} /></Pressable>;
}

function isBlindRecallSession(session: RecallSession | null): boolean {
  return typeof session?.launchContext?.query === "string" && session.launchContext.query.startsWith("blind:");
}

function isRecentRecallSession(session: RecallSession | null): boolean {
  return typeof session?.launchContext?.query === "string" && session.launchContext.query.startsWith("recent:");
}

function isTimeCapsuleRecallSession(session: RecallSession | null): boolean {
  return isTimeCapsuleQuery(session?.launchContext?.query);
}

function TopicModal({ visible, value, searchState, onChange, onClose, onSubmit }: { visible: boolean; value: string; searchState: "idle" | "searching" | "empty"; onChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  const searching = searchState === "searching";
  const enabled = Boolean(value.trim()) && !searching;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.scrim} onPress={onClose}><Pressable style={styles.panel} onPress={() => undefined}><Text style={styles.panelTitle}>{t("recall.explore")}</Text><View style={styles.topicInputRow}><TextInput autoFocus editable={!searching} value={value} onChangeText={onChange} placeholder={t("recall.topic_placeholder")} placeholderTextColor={theme.colors.textMuted} style={styles.topicInput} returnKeyType="go" onSubmitEditing={() => enabled && onSubmit()} /><Pressable disabled={!enabled} style={[styles.topicGo, !enabled && styles.topicGoDisabled]} onPress={onSubmit}>{searching ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : <Ionicons name="arrow-forward" size={18} color={enabled ? "#fff" : theme.colors.textMuted} />}</Pressable></View>{searching ? <View style={styles.topicStatus}><ActivityIndicator size="small" color={theme.colors.textMuted} /><Text style={styles.topicStatusText}>{t("recall.searching")}</Text></View> : searchState === "empty" ? <Text style={styles.topicEmpty}>{t("recall.error.empty")}</Text> : null}</Pressable></Pressable></Modal>;
}

function RecallSummary({ summary, onDone, onAgain, loading }: { summary: { cards: number; attempted: number; correct: number }; onDone: () => void; onAgain?: () => void; loading: boolean }) {
  const scale = useRef(new Animated.Value(.88)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.parallel([Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 15, bounciness: 7 }), Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true })]).start(); }, [opacity, scale]);
  return <SafeAreaView style={styles.summaryPage}><Animated.View style={[styles.summaryCard, { opacity, transform: [{ scale }] }]}><View style={styles.summaryIcon}><Ionicons name="checkmark-done-circle" size={30} color="#58916B" /></View><Text style={styles.summaryTitle}>{t("recall.summary_title")}</Text><View style={styles.summaryStats}><SummaryStat value={summary.cards} label={t("recall.summary_cards_short")} /><SummaryStat value={summary.attempted} label={t("recall.summary_blanks")} /><SummaryStat value={summary.correct} label={t("recall.summary_correct")} /></View>{onAgain ? <Pressable disabled={loading} style={[styles.startButton, loading && styles.disabled]} onPress={onAgain}>{loading ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={styles.startButtonText}>{t("recall.summary_again")}</Text>}</Pressable> : null}<Pressable style={[styles.startButton, onAgain && styles.summaryDoneSecondary]} onPress={onDone}><Text style={[styles.startButtonText, onAgain && styles.summaryDoneSecondaryText]}>{t("recall.summary_done")}</Text></Pressable></Animated.View></SafeAreaView>;
}

function SummaryStat({ value, label }: { value: number; label: string }) { return <View style={styles.summaryStat}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>; }
function DayCard({ title, count, onPress }: { title: string; count: number; onPress: () => void }) { const disabled = count === 0; return <Pressable disabled={disabled} style={[styles.dayCard, disabled && styles.disabled]} onPress={onPress}><Text style={styles.dayTitle}>{title}</Text><Text style={styles.dayCount}>{count ? tf("recall.card_count", { count }) : t("recall.no_cards")}</Text><Ionicons name="arrow-forward" size={17} color={disabled ? theme.colors.border : theme.colors.text} /></Pressable>; }

function filterAvailableRecallSession(value: RecallSession, availableRecordIds: Set<string>): RecallSession {
  const nodes = value.nodes.filter((node) => availableRecordIds.has(node.recordId));
  const nodeIds = new Set(nodes.map((node) => node.id));
  return { ...value, nodes, edges: value.edges.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId)) };
}
function localDateKey(date: Date): string { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function dateFromKey(value: string): Date { return new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))); }
function timeCapsuleLabel(anchor: RecallTimeCapsuleAnchor): string {
  const date = new Intl.DateTimeFormat(getLanguage(), { year: "numeric", month: "short", day: "numeric" }).format(dateFromKey(anchor.dateKey));
  if (anchor.kind === "year") return tf("recall.time_capsule.year", { date });
  if (anchor.kind === "quarter") return tf("recall.time_capsule.quarter", { date });
  if (anchor.kind === "month") return tf("recall.time_capsule.month", { date });
  return tf("recall.time_capsule.week", { date });
}
function completedCards(rows: CardRecordSummary[]): CardRecordSummary[] {
  return rows.filter((row) => row.status === "completed" && !row.isSample);
}
function hasRecallCloze(detail: CardRecordDetail | null): boolean {
  if (!detail) return false;
  const blocks = detail.contentBlocks ?? [];
  const hasRewrite = blocks.some((block) => block.contentType === "rewrite");
  const practiceBlocks = blocks.filter((block) => {
    if (block.contentType.startsWith("image:") || block.contentType === "reply") return true;
    if (detail.mode === "corpus") return block.contentType === "original";
    return block.contentType === "rewrite" || !hasRewrite && block.contentType === "original";
  });
  const practices = practiceBlocks.length ? practiceBlocks.map((block) => block.practice) : [detail.practice];
  return practices.some((practice) => {
    const state = practice?.clozeState;
    return Boolean(
      practice?.hasCloze
      || state && typeof state === "object" && "blanks" in state && Array.isArray(state.blanks) && state.blanks.length > 0,
    );
  });
}
function shuffle<T>(items: T[]): T[] { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(Math.random() * (index + 1)); [items[index], items[target]] = [items[target]!, items[index]!]; } return items; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.canvas }, directLaunchPage: { flex: 1, backgroundColor: theme.colors.canvas, alignItems: "center", justifyContent: "center" }, deckPage: { flex: 1, backgroundColor: theme.colors.canvas }, header: { height: 60, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" }, headerSide: { width: 46, height: 46, alignItems: "center", justifyContent: "center" }, headerTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 18, fontWeight: "600" },
  home: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 100 }, memoryHero: { minHeight: 128, marginBottom: 16, padding: 20, borderRadius: 24, backgroundColor: "#EAF6F1", borderWidth: 1, borderColor: "#CFE8DE" }, memoryHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, memoryHeroTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, memoryHeroTitle: { color: "#294D42", fontSize: 22, fontWeight: "600" }, memoryResumeBadge: { overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9, backgroundColor: "rgba(255,255,255,.8)", color: "#49675D", fontSize: 10, fontWeight: "600" }, memoryHeroArrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.72)", alignItems: "center", justifyContent: "center" }, memoryPath: { marginTop: 25, flexDirection: "row", alignItems: "center" }, memoryNode: { width: 18, height: 18, borderRadius: 9 }, memoryConnector: { flex: 1, height: 3, borderRadius: 2 }, dayRow: { flexDirection: "row", gap: 12 }, dayCard: { flex: 1, minHeight: 145, padding: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: "flex-start" }, disabled: { opacity: .42 }, dayTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "600" }, dayCount: { flex: 1, marginTop: 8, color: theme.colors.textMuted, fontSize: 12 },
  choice: { minHeight: 58, marginTop: 11, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 14, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 11 }, choiceIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" }, choiceBody: { flex: 1, paddingVertical: 10 }, choiceText: { color: theme.colors.text, fontSize: 15, fontWeight: "500" }, choiceSubtitle: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12 }, resume: { minHeight: 52, marginBottom: 14, paddingHorizontal: 16, borderRadius: 13, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center" }, resumeText: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "500" }, createHint: { marginTop: 20, minHeight: 46, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, createHintText: { color: theme.colors.text, fontSize: 14 }, loader: { marginTop: 28 },
  scrim: { flex: 1, paddingHorizontal: 24, backgroundColor: "rgba(0,0,0,.28)", justifyContent: "center" }, panel: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 18, borderRadius: 18, backgroundColor: theme.colors.surface }, panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, panelTitle: { marginBottom: 10, color: theme.colors.text, fontSize: 18, lineHeight: 24, fontWeight: "600" }, topicInputRow: { height: 48, paddingLeft: 13, paddingRight: 4, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, flexDirection: "row", alignItems: "center" }, topicInput: { flex: 1, height: 46, paddingHorizontal: 0, paddingVertical: 0, color: theme.colors.text, fontSize: 15 }, topicGo: { width: 38, height: 38, borderRadius: 9, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" }, topicGoDisabled: { backgroundColor: theme.colors.surfaceMuted }, topicStatus: { minHeight: 34, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }, topicStatusText: { color: theme.colors.textMuted, fontSize: 13 }, topicEmpty: { minHeight: 34, marginTop: 8, color: theme.colors.textSecondary, fontSize: 13 },
  startButton: { height: 48, marginTop: 18, borderRadius: 14, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" }, startButtonText: { color: theme.colors.surface, fontSize: 15, fontWeight: "600" },
  busyOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,.55)", alignItems: "center", justifyContent: "center" }, summaryPage: { flex: 1, paddingHorizontal: 24, backgroundColor: "#F4F7F3", alignItems: "center", justifyContent: "center" }, summaryCard: { width: "100%", maxWidth: 430, padding: 24, borderRadius: 24, backgroundColor: theme.colors.surface, shadowColor: "#315D3F", shadowOpacity: .1, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 4 }, summaryIcon: { width: 58, height: 58, alignSelf: "center", borderRadius: 29, backgroundColor: "#E5F2E8", alignItems: "center", justifyContent: "center" }, summaryTitle: { marginTop: 15, textAlign: "center", color: theme.colors.text, fontSize: 23, fontWeight: "600" }, summaryStats: { marginTop: 25, flexDirection: "row" }, summaryStat: { flex: 1, alignItems: "center" }, summaryValue: { color: theme.colors.text, fontSize: 27, fontWeight: "600" }, summaryLabel: { marginTop: 5, color: theme.colors.textMuted, fontSize: 12 },
  summaryDoneSecondary: { marginTop: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }, summaryDoneSecondaryText: { color: theme.colors.text },
});
