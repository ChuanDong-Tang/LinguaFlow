import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Easing, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t, tf } from "../i18n";
import { logEvent } from "../services/logger";
import {
  createRecallSessionFromRecords,
  finishRecallSession,
  getActiveRecallSession,
  getCardDateKeys,
  getCardRecord,
  getCardRecords,
  searchRecallCards,
  updateRecallNode,
  type CardRecordDetail,
  type CardRecordSummary,
  type RecallSession,
} from "../services/api/cardApi";
import { theme } from "../theme";
import { CardCalendarScreen } from "./CardCalendarScreen";
import { CardDetailModal } from "./CardDetailModal";

type Stage = "home" | "deck" | "summary";
type BlindPeriod = "week" | "month" | "quarter" | "year" | "all";
const BLIND_BOX_SETTINGS_KEY = "linguaflow.recall.blind_box.settings.v1";

export function RecallScreen({ isActive, onOpenLibrary, launchRequest = null }: { isActive: boolean; onOpenLibrary: () => void; launchRequest?: { key: number; mode: "today" | "yesterday" | "blind" } | null }) {
  const [stage, setStage] = useState<Stage>("home");
  const [loading, setLoading] = useState(false);
  const [todayCards, setTodayCards] = useState<CardRecordSummary[]>([]);
  const [yesterdayCards, setYesterdayCards] = useState<CardRecordSummary[]>([]);
  const [dateKeys, setDateKeys] = useState<string[]>([]);
  const [activeSession, setActiveSession] = useState<RecallSession | null>(null);
  const [session, setSession] = useState<RecallSession | null>(null);
  const [cards, setCards] = useState<Record<string, CardRecordDetail>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [attempts, setAttempts] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState({ cards: 0, attempted: 0, correct: 0 });
  const [completedBlindBox, setCompletedBlindBox] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [topicVisible, setTopicVisible] = useState(false);
  const [topic, setTopic] = useState("");
  const [topicSearchState, setTopicSearchState] = useState<"idle" | "searching" | "empty">("idle");
  const [blindVisible, setBlindVisible] = useState(false);
  const [blindPeriod, setBlindPeriod] = useState<BlindPeriod>("quarter");
  const [blindCount, setBlindCount] = useState(5);
  const [directLaunchPending, setDirectLaunchPending] = useState(Boolean(launchRequest));
  const handledLaunchRef = useRef<number | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(BLIND_BOX_SETTINGS_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as { period?: BlindPeriod; count?: number };
        if (["week", "month", "quarter", "year", "all"].includes(saved.period ?? "")) setBlindPeriod(saved.period!);
        if (Number.isInteger(saved.count) && saved.count! >= 1 && saved.count! <= 10) setBlindCount(saved.count!);
      } catch { /* Keep defaults when local settings are malformed. */ }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!launchRequest || handledLaunchRef.current === launchRequest.key) return;
    setDirectLaunchPending(true);
  }, [launchRequest?.key]);

  const loadHome = useCallback(async () => {
    setLoading(true);
    try {
      const today = localDateKey(new Date());
      const yesterday = localDateKey(new Date(Date.now() - 86_400_000));
      const [todayRows, yesterdayRows, keys, active] = await Promise.all([
        getCardRecords({ dateKey: today, limit: 50 }),
        getCardRecords({ dateKey: yesterday, limit: 50 }),
        getCardDateKeys("2000-01-01", today),
        getActiveRecallSession(),
      ]);
      const validKeys = [...keys].sort();
      setTodayCards(completedCards(todayRows));
      setYesterdayCards(completedCards(yesterdayRows));
      setDateKeys(validKeys);
      setActiveSession(active?.nodes.length ? active : null);
      if (launchRequest && handledLaunchRef.current !== launchRequest.key) {
        handledLaunchRef.current = launchRequest.key;
        if (launchRequest.mode === "blind") {
          setBlindVisible(true);
          setDirectLaunchPending(false);
        }
        else {
          const rows = launchRequest.mode === "today" ? completedCards(todayRows) : completedCards(yesterdayRows);
          if (!rows.length) {
            setDirectLaunchPending(false);
            Alert.alert(t("recall.error.empty"));
            onOpenLibrary();
            return;
          }
          await beginRecords(rows.map((row) => row.id), launchRequest.mode === "today" ? today : yesterday);
          setDirectLaunchPending(false);
        }
      }
    } catch {
      setDirectLaunchPending(false);
      Alert.alert(t("recall.error.load"));
    } finally {
      setLoading(false);
    }
  }, [launchRequest?.key]);

  useEffect(() => { if (isActive && stage === "home") void loadHome(); }, [isActive, stage, loadHome]);

  async function hydrate(value: RecallSession): Promise<Record<string, CardRecordDetail>> {
    const rows = await Promise.all(value.nodes.map(async (node) => {
      try { return [node.recordId, await getCardRecord(node.recordId)] as const; }
      catch { return null; }
    }));
    return Object.fromEntries(rows.filter((row): row is NonNullable<typeof row> => Boolean(row)));
  }

  async function openSession(value: RecallSession, resume = false): Promise<void> {
    if (!value.nodes.length) throw new Error("Recall session has no cards");
    const resumeIndex = resume ? Math.max(0, value.nodes.findIndex((node) => node.state !== "completed")) : 0;
    const initialIndex = resumeIndex < 0 ? 0 : resumeIndex;
    const hydratedCards = await hydrate(value);
    const node = value.nodes[initialIndex];
    if (!node || !hydratedCards[node.recordId]) throw new Error("Recall card could not be loaded");
    setCards(hydratedCards);
    setSession(value);
    setAttempts({});
    setCurrentIndex(initialIndex);
    setStage("deck");
    if (node) void markNode(value.id, node.id, "current", setSession);
  }

  async function beginRecords(recordIds: string[], query?: string): Promise<boolean> {
    const uniqueIds = [...new Set(recordIds)].slice(0, 50);
    if (!uniqueIds.length) {
      Alert.alert(t("recall.error.empty"));
      return false;
    }
    setLoading(true);
    try {
      const created = await createRecallSessionFromRecords(uniqueIds, query);
      setCompletedBlindBox(query?.startsWith("blind:") === true);
      await openSession(created);
      return true;
    } catch (error) {
      void logEvent("recall_session_start_failed", "error", error instanceof Error ? error.message : String(error), {
        cardCount: uniqueIds.length,
        source: query?.startsWith("blind:") ? "blind_box" : "records",
      }).catch(() => undefined);
      Alert.alert(t("recall.error.start_title"), t("recall.error.retry"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function resume(): Promise<void> {
    if (!activeSession) return;
    setLoading(true);
    try { await openSession(activeSession, true); }
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

  async function beginBlindBox(): Promise<void> {
    const { from, to } = resolveBlindPeriodRange(blindPeriod, dateKeys);
    const eligibleKeys = shuffle(dateKeys.filter((key) => key >= from && key <= to));
    if (!eligibleKeys.length) {
      Alert.alert(t("recall.error.empty"));
      return;
    }
    setLoading(true);
    try {
      const candidates: string[] = [];
      for (const key of eligibleKeys) {
        const rows = completedCards(await getCardRecords({ dateKey: key, limit: 200 }));
        candidates.push(...shuffle(rows.map((row) => row.id)));
        if (candidates.length >= blindCount * 2) break;
      }
      const selected = shuffle([...new Set(candidates)]).slice(0, blindCount);
      if (!selected.length) {
        Alert.alert(t("recall.error.empty"));
        return;
      }
      const started = await beginRecords(selected, `blind:${blindPeriod}:${from}:${to}`);
      if (started) setBlindVisible(false);
    } catch (error) {
      void logEvent("recall_blind_box_start_failed", "error", error instanceof Error ? error.message : String(error), {
        period: blindPeriod,
        count: blindCount,
      }).catch(() => undefined);
      Alert.alert(t("recall.error.start_title"), t("recall.error.retry"));
    } finally {
      setLoading(false);
    }
  }

  function updateBlindPeriod(period: BlindPeriod): void {
    setBlindPeriod(period);
    void saveBlindSettings(period, blindCount);
  }

  function updateBlindCount(count: number): void {
    setBlindCount(count);
    void saveBlindSettings(blindPeriod, count);
  }

  function navigateDeck(nextIndex: number): void {
    if (!session || nextIndex < 0 || nextIndex >= session.nodes.length || nextIndex === currentIndex) return;
    const current = session.nodes[currentIndex];
    const next = session.nodes[nextIndex];
    setCurrentIndex(nextIndex);
    if (current && next) void (async () => {
      try {
        await updateRecallNode(session.id, current.id, "completed");
        const latest = await updateRecallNode(session.id, next.id, "current");
        setSession(latest);
      } catch {
        // Navigation remains available when a progress marker cannot be persisted.
      }
    })();
  }

  function leaveDeck(): void {
    setSession(null);
    setCards({});
    if (launchRequest) {
      onOpenLibrary();
      return;
    }
    setStage("home");
  }

  function finishSummary(): void {
    setSession(null);
    setCards({});
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
      const current = session.nodes[currentIndex];
      if (current) await markNode(session.id, current.id, "completed", setSession);
      await finishRecallSession(session.id);
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
  if (stage === "deck" && session && currentNode) return <View style={styles.deckPage}>
    <CardDetailModal
      detail={currentDetail}
      loading={!currentDetail}
      initialTab={hasRecallCloze(currentDetail) ? "cloze" : "review"}
      hideRelations
      onClose={leaveDeck}
      recallPosition={{ index: currentIndex, total: session.nodes.length }}
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

  if (stage === "summary") return <RecallSummary summary={summary} onDone={finishSummary} onAgain={completedBlindBox ? () => void beginBlindBox() : undefined} loading={loading} />;

  if (directLaunchPending) return <SafeAreaView style={styles.directLaunchPage}><ActivityIndicator size="large" color={theme.colors.text} /></SafeAreaView>;

  if (launchRequest?.mode === "blind") return <SafeAreaView style={styles.directLaunchPage}>
    <BlindBoxModal visible period={blindPeriod} count={blindCount} loading={loading} onClose={onOpenLibrary} onPeriodChange={updateBlindPeriod} onCountChange={updateBlindCount} onStart={() => void beginBlindBox()} />
  </SafeAreaView>;

  return <SafeAreaView style={styles.page}>
    <View style={styles.header}><Pressable accessibilityLabel={t("recall.a11y.back")} style={styles.headerSide} onPress={onOpenLibrary}><Ionicons name="chevron-back" size={25} color={theme.colors.text} /></Pressable><Text style={styles.headerTitle}>{t("recall.title")}</Text><View style={styles.headerSide} /></View>
    <ScrollView contentContainerStyle={styles.home} showsVerticalScrollIndicator={false}>
      {activeSession ? <Pressable style={styles.resume} onPress={() => void resume()}><Text style={styles.resumeText}>{t("recall.resume")}</Text><Ionicons name="arrow-forward" size={18} color={theme.colors.text} /></Pressable> : null}
      <View style={styles.dayRow}>
        <DayCard title={t("recall.today")} count={todayCards.length} onPress={() => void beginRecords(todayCards.map((row) => row.id), localDateKey(new Date()))} />
        <DayCard title={t("recall.yesterday")} count={yesterdayCards.length} onPress={() => void beginRecords(yesterdayCards.map((row) => row.id), localDateKey(new Date(Date.now() - 86_400_000)))} />
      </View>
      <RecallChoice icon="calendar-outline" title={t("recall.select_date")} disabled={!dateKeys.length} onPress={() => setDatePickerVisible(true)} />
      <RecallChoice icon="search-outline" title={t("recall.explore")} disabled={!dateKeys.length} onPress={() => setTopicVisible(true)} />
      <RecallChoice icon="cube-outline" title={t("recall.blind_box")} disabled={!dateKeys.length} onPress={() => setBlindVisible(true)} />
      {!loading && !dateKeys.length ? <Pressable style={styles.createHint} onPress={onOpenLibrary}><Text style={styles.createHintText}>{t("recall.create_more")}</Text><Ionicons name="add" size={18} color={theme.colors.text} /></Pressable> : null}
      {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.text} /> : null}
    </ScrollView>
    <CardCalendarScreen visible={datePickerVisible} onClose={() => setDatePickerVisible(false)} onSelectDate={(value) => void beginSelectedDate(dateFromKey(value))} />
    <TopicModal visible={topicVisible} value={topic} searchState={topicSearchState} onChange={(value) => { setTopic(value); setTopicSearchState("idle"); }} onClose={() => { if (topicSearchState !== "searching") { setTopicVisible(false); setTopicSearchState("idle"); } }} onSubmit={() => void beginTopic()} />
    <BlindBoxModal visible={blindVisible} period={blindPeriod} count={blindCount} loading={loading} onClose={() => !loading && setBlindVisible(false)} onPeriodChange={updateBlindPeriod} onCountChange={updateBlindCount} onStart={() => void beginBlindBox()} />
  </SafeAreaView>;
}

function RecallChoice({ icon, title, subtitle, disabled, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; subtitle?: string; disabled: boolean; onPress: () => void }) {
  return <Pressable disabled={disabled} style={[styles.choice, disabled && styles.disabled]} onPress={onPress}><View style={styles.choiceIcon}><Ionicons name={icon} size={20} color={theme.colors.text} /></View><View style={styles.choiceBody}><Text style={styles.choiceText}>{title}</Text>{subtitle ? <Text style={styles.choiceSubtitle}>{subtitle}</Text> : null}</View><Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} /></Pressable>;
}

function TopicModal({ visible, value, searchState, onChange, onClose, onSubmit }: { visible: boolean; value: string; searchState: "idle" | "searching" | "empty"; onChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  const searching = searchState === "searching";
  const enabled = Boolean(value.trim()) && !searching;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><Pressable style={styles.scrim} onPress={onClose}><Pressable style={styles.panel} onPress={() => undefined}><Text style={styles.panelTitle}>{t("recall.explore")}</Text><View style={styles.topicInputRow}><TextInput autoFocus editable={!searching} value={value} onChangeText={onChange} placeholder={t("recall.topic_placeholder")} placeholderTextColor={theme.colors.textMuted} style={styles.topicInput} returnKeyType="go" onSubmitEditing={() => enabled && onSubmit()} /><Pressable disabled={!enabled} style={[styles.topicGo, !enabled && styles.topicGoDisabled]} onPress={onSubmit}>{searching ? <ActivityIndicator size="small" color={theme.colors.textMuted} /> : <Ionicons name="arrow-forward" size={18} color={enabled ? "#fff" : theme.colors.textMuted} />}</Pressable></View>{searching ? <View style={styles.topicStatus}><ActivityIndicator size="small" color={theme.colors.textMuted} /><Text style={styles.topicStatusText}>{t("recall.searching")}</Text></View> : searchState === "empty" ? <Text style={styles.topicEmpty}>{t("recall.error.empty")}</Text> : null}</Pressable></Pressable></Modal>;
}

function BlindBoxModal({ visible, period, count, loading, onClose, onPeriodChange, onCountChange, onStart }: { visible: boolean; period: BlindPeriod; count: number; loading: boolean; onClose: () => void; onPeriodChange: (period: BlindPeriod) => void; onCountChange: (count: number) => void; onStart: () => void }) {
  const periods: Array<{ value: BlindPeriod; label: string }> = [
    { value: "week", label: t("recall.period.week") },
    { value: "month", label: t("recall.period.month") },
    { value: "quarter", label: t("recall.period.quarter") },
    { value: "year", label: t("recall.period.year") },
    { value: "all", label: t("recall.period.all") },
  ];
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.scrim} onPress={onClose}>
      <Pressable style={styles.panel} onPress={() => undefined}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{t("recall.blind_settings")}</Text>
          <Pressable onPress={onClose}><Ionicons name="close" size={22} color={theme.colors.text} /></Pressable>
        </View>
        <Text style={styles.blindOptionLabel}>{t("recall.period.title")}</Text>
        <View style={styles.periodSegments}>
          {periods.map((item) => <Pressable key={item.value} style={[styles.periodSegment, period === item.value && styles.periodSegmentActive]} onPress={() => onPeriodChange(item.value)}><Text numberOfLines={1} style={[styles.periodSegmentText, period === item.value && styles.periodSegmentTextActive]}>{item.label}</Text></Pressable>)}
        </View>
        <View style={styles.blindCountHeader}><Text style={styles.blindOptionLabel}>{t("recall.card_amount")}</Text><Text style={styles.blindCountValue}>{count}</Text></View>
        <BlindCountSlider value={count} onChange={onCountChange} />
        <View style={styles.countEndpoints}><Text style={styles.countEndpoint}>1</Text><Text style={styles.countEndpoint}>10</Text></View>
        <Pressable disabled={loading} style={[styles.startButton, loading && styles.disabled]} onPress={onStart}>{loading ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={styles.startButtonText}>{t("recall.start")}</Text>}</Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

function BlindCountSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const updateFromPosition = (x: number) => {
    if (widthRef.current <= 0) return;
    const next = Math.max(1, Math.min(10, Math.round((x / widthRef.current) * 9) + 1));
    onChangeRef.current(next);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2,
    onPanResponderGrant: (event) => updateFromPosition(event.nativeEvent.locationX),
    onPanResponderMove: (event) => updateFromPosition(event.nativeEvent.locationX),
  }), []);
  const progress = (value - 1) / 9;
  return <View
    accessibilityRole="adjustable"
    accessibilityValue={{ min: 1, max: 10, now: value }}
    style={styles.countSlider}
    onLayout={(event) => { widthRef.current = event.nativeEvent.layout.width; }}
    {...responder.panHandlers}
  >
    <View style={styles.countSliderTrack} />
    <View pointerEvents="none" style={[styles.countSliderProgress, { width: `${progress * 100}%` }]} />
    {Array.from({ length: 10 }, (_, index) => <View pointerEvents="none" key={index} style={[styles.countSliderTick, { left: `${(index / 9) * 100}%` }]} />)}
    <View pointerEvents="none" style={[styles.countSliderThumb, { left: `${progress * 100}%` }]} />
  </View>;
}

function RecallSummary({ summary, onDone, onAgain, loading }: { summary: { cards: number; attempted: number; correct: number }; onDone: () => void; onAgain?: () => void; loading: boolean }) {
  const scale = useRef(new Animated.Value(.88)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.parallel([Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 15, bounciness: 7 }), Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true })]).start(); }, [opacity, scale]);
  return <SafeAreaView style={styles.summaryPage}><Animated.View style={[styles.summaryCard, { opacity, transform: [{ scale }] }]}><View style={styles.summaryIcon}><Ionicons name="sparkles" size={30} color="#58916B" /></View><Text style={styles.summaryTitle}>{t("recall.summary_title")}</Text><View style={styles.summaryStats}><SummaryStat value={summary.cards} label={t("recall.summary_cards_short")} /><SummaryStat value={summary.attempted} label={t("recall.summary_blanks")} /><SummaryStat value={summary.correct} label={t("recall.summary_correct")} /></View>{onAgain ? <Pressable disabled={loading} style={[styles.startButton, loading && styles.disabled]} onPress={onAgain}>{loading ? <ActivityIndicator color={theme.colors.surface} /> : <Text style={styles.startButtonText}>{t("recall.summary_again")}</Text>}</Pressable> : null}<Pressable style={[styles.startButton, onAgain && styles.summaryDoneSecondary]} onPress={onDone}><Text style={[styles.startButtonText, onAgain && styles.summaryDoneSecondaryText]}>{t("recall.summary_done")}</Text></Pressable></Animated.View></SafeAreaView>;
}

function SummaryStat({ value, label }: { value: number; label: string }) { return <View style={styles.summaryStat}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>; }
function DayCard({ title, count, onPress }: { title: string; count: number; onPress: () => void }) { const disabled = count === 0; return <Pressable disabled={disabled} style={[styles.dayCard, disabled && styles.disabled]} onPress={onPress}><Text style={styles.dayTitle}>{title}</Text><Text style={styles.dayCount}>{count ? tf("recall.card_count", { count }) : t("recall.no_cards")}</Text><Ionicons name="arrow-forward" size={17} color={disabled ? theme.colors.border : theme.colors.text} /></Pressable>; }

async function markNode(sessionId: string, nodeId: string, state: RecallSession["nodes"][number]["state"], update: React.Dispatch<React.SetStateAction<RecallSession | null>>): Promise<void> { try { const next = await updateRecallNode(sessionId, nodeId, state); update(next); } catch { /* A failed marker must not interrupt practice. */ } }
function localDateKey(date: Date): string { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function dateFromKey(value: string): Date { return new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))); }
function resolveBlindPeriodRange(period: BlindPeriod, dateKeys: string[]): { from: string; to: string } {
  const now = new Date();
  const to = localDateKey(now);
  if (period === "all") return { from: dateKeys[0] ?? to, to };
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") {
    const weekday = from.getDay() || 7;
    from.setDate(from.getDate() - weekday + 1);
  } else if (period === "month") {
    from.setDate(1);
  } else if (period === "quarter") {
    from.setMonth(Math.floor(from.getMonth() / 3) * 3, 1);
  } else {
    from.setMonth(0, 1);
  }
  return { from: localDateKey(from), to };
}
async function saveBlindSettings(period: BlindPeriod, count: number): Promise<void> {
  await AsyncStorage.setItem(BLIND_BOX_SETTINGS_KEY, JSON.stringify({ period, count })).catch(() => undefined);
}
function completedCards(rows: CardRecordSummary[]): CardRecordSummary[] {
  return rows.filter((row) => row.status === "completed" && !row.isSample);
}
function hasRecallCloze(detail: CardRecordDetail | null): boolean {
  if (!detail) return false;
  const blocks = detail.contentBlocks ?? [];
  const learningBlock = blocks.find((block) => block.contentType === "rewrite")
    ?? blocks.find((block) => block.contentType === "original")
    ?? blocks[0];
  const practice = learningBlock?.practice ?? detail.practice;
  const state = practice?.clozeState;
  return Boolean(
    practice?.hasCloze
    || state && typeof state === "object" && "blanks" in state && Array.isArray(state.blanks) && state.blanks.length > 0,
  );
}
function shuffle<T>(items: T[]): T[] { for (let index = items.length - 1; index > 0; index -= 1) { const target = Math.floor(Math.random() * (index + 1)); [items[index], items[target]] = [items[target]!, items[index]!]; } return items; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.canvas }, directLaunchPage: { flex: 1, backgroundColor: theme.colors.canvas, alignItems: "center", justifyContent: "center" }, deckPage: { flex: 1, backgroundColor: theme.colors.canvas }, header: { height: 60, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" }, headerSide: { width: 46, height: 46, alignItems: "center", justifyContent: "center" }, headerTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 18, fontWeight: "600" },
  home: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 100 }, dayRow: { flexDirection: "row", gap: 12 }, dayCard: { flex: 1, minHeight: 145, padding: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: "flex-start" }, disabled: { opacity: .42 }, dayTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "600" }, dayCount: { flex: 1, marginTop: 8, color: theme.colors.textMuted, fontSize: 12 },
  choice: { minHeight: 58, marginTop: 11, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: 14, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 11 }, choiceIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: theme.colors.surfaceMuted, alignItems: "center", justifyContent: "center" }, choiceBody: { flex: 1, paddingVertical: 10 }, choiceText: { color: theme.colors.text, fontSize: 15, fontWeight: "500" }, choiceSubtitle: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12 }, resume: { minHeight: 52, marginBottom: 14, paddingHorizontal: 16, borderRadius: 13, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row", alignItems: "center" }, resumeText: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "500" }, createHint: { marginTop: 20, minHeight: 46, paddingHorizontal: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, createHintText: { color: theme.colors.text, fontSize: 14 }, loader: { marginTop: 28 },
  scrim: { flex: 1, paddingHorizontal: 24, backgroundColor: "rgba(0,0,0,.28)", justifyContent: "center" }, panel: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 18, borderRadius: 18, backgroundColor: theme.colors.surface }, panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, panelTitle: { marginBottom: 10, color: theme.colors.text, fontSize: 18, lineHeight: 24, fontWeight: "600" }, topicInputRow: { height: 48, paddingLeft: 13, paddingRight: 4, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, flexDirection: "row", alignItems: "center" }, topicInput: { flex: 1, height: 46, paddingHorizontal: 0, paddingVertical: 0, color: theme.colors.text, fontSize: 15 }, topicGo: { width: 38, height: 38, borderRadius: 9, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" }, topicGoDisabled: { backgroundColor: theme.colors.surfaceMuted }, topicStatus: { minHeight: 34, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }, topicStatusText: { color: theme.colors.textMuted, fontSize: 13 }, topicEmpty: { minHeight: 34, marginTop: 8, color: theme.colors.textSecondary, fontSize: 13 },
  blindOptionLabel: { marginTop: 16, color: theme.colors.text, fontSize: 14, fontWeight: "500" }, periodSegments: { height: 44, marginTop: 10, padding: 3, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted, flexDirection: "row" }, periodSegment: { flex: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" }, periodSegmentActive: { backgroundColor: theme.colors.surface, shadowColor: "#000", shadowOpacity: .08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 }, periodSegmentText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "500" }, periodSegmentTextActive: { color: theme.colors.text }, blindCountHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, blindCountValue: { marginTop: 16, color: theme.colors.text, fontSize: 16, fontWeight: "600" }, countSlider: { height: 38, marginHorizontal: 10, marginTop: 7, justifyContent: "center" }, countSliderTrack: { position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }, countSliderProgress: { position: "absolute", left: 0, height: 4, borderRadius: 2, backgroundColor: theme.colors.text }, countSliderTick: { position: "absolute", width: 2, height: 8, marginLeft: -1, borderRadius: 1, backgroundColor: theme.colors.border }, countSliderThumb: { position: "absolute", width: 22, height: 22, marginLeft: -11, borderWidth: 2, borderColor: theme.colors.surface, borderRadius: 11, backgroundColor: theme.colors.text, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 }, countEndpoints: { marginTop: -3, paddingHorizontal: 9, flexDirection: "row", justifyContent: "space-between" }, countEndpoint: { color: theme.colors.textMuted, fontSize: 11 }, startButton: { height: 48, marginTop: 18, borderRadius: 14, backgroundColor: theme.colors.text, alignItems: "center", justifyContent: "center" }, startButtonText: { color: theme.colors.surface, fontSize: 15, fontWeight: "600" },
  busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,.55)", alignItems: "center", justifyContent: "center" }, summaryPage: { flex: 1, paddingHorizontal: 24, backgroundColor: "#F4F7F3", alignItems: "center", justifyContent: "center" }, summaryCard: { width: "100%", maxWidth: 430, padding: 24, borderRadius: 24, backgroundColor: theme.colors.surface, shadowColor: "#315D3F", shadowOpacity: .1, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 4 }, summaryIcon: { width: 58, height: 58, alignSelf: "center", borderRadius: 29, backgroundColor: "#E5F2E8", alignItems: "center", justifyContent: "center" }, summaryTitle: { marginTop: 15, textAlign: "center", color: theme.colors.text, fontSize: 23, fontWeight: "600" }, summaryStats: { marginTop: 25, flexDirection: "row" }, summaryStat: { flex: 1, alignItems: "center" }, summaryValue: { color: theme.colors.text, fontSize: 27, fontWeight: "600" }, summaryLabel: { marginTop: 5, color: theme.colors.textMuted, fontSize: 12 },
  summaryDoneSecondary: { marginTop: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }, summaryDoneSecondaryText: { color: theme.colors.text },
});
