import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Keyboard, Linking, Modal, Pressable, useWindowDimensions, View, type ViewToken } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import Reanimated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming, ZoomIn } from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import * as MediaLibrary from "expo-media-library/legacy";
import { FlashList } from "@shopify/flash-list";
import { Text, TextInput } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { RealtimeSttButton } from "../../components/RealtimeSttButton";
import { CheckMark, PressableSurface } from "../../components/surface/Surface";
import { useRealtimeSttInput } from "../../hooks/useRealtimeSttInput";
import { haptic } from "../../feedback/haptics";
import { motion } from "../../motion";
import { getLanguage, t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { canReadMemoryPhoto, readMemoryPhotoPage, requestMemoryPhotoPermission } from "../../services/device/memoryPhotoLibrary";
import { createMemoryPhotoPager, type PhotoPagerState } from "../../services/device/memoryPhotoPager";
import { isRecentPhoto, nextPhotoSet, photoBatch, photoTakenTime, relativePhotoDay } from "../../services/device/memoryPhotoPolicy";
import { memoryPhotoCopy } from "./memoryPhotoCopy";
import { MemoryPhotoPreview } from "./MemoryPhotoPreview";

type Asset = MediaLibrary.Asset;
const SET_SIZES = [5, 15, 30] as const;

/**
 * Photo inspiration (2026-11 redesign): browse photos full screen, one at a
 * time, with no input box in the way. Swipe up on a photo you want to write
 * about; after the set, optionally practice the memories you just made.
 * Photos are uploaded only when the user taps 改写 for that photo.
 */
export function MemoryPhotoBrowser({ random = false, onClose, onConfirm, onPracticeSet, maxTextLength }: {
  random?: boolean;
  onClose: () => void;
  /** Create a memory from this photo; resolves with the new card id. */
  onConfirm: (asset: Asset, text: string, title: string) => Promise<string | null>;
  onPracticeSet: (recordIds: string[]) => void;
  maxTextLength: number;
}) {
  const copy = (zh: string, en: string) => memoryPhotoCopy(getLanguage(), zh, en);
  const { width, height } = useWindowDimensions();
  const [state, setState] = useState<PhotoPagerState<Asset>>({ assets: [], access: "undetermined", canAskAgain: true, hasNextPage: true, loading: true, error: false });
  const pagerRef = useRef<ReturnType<typeof createMemoryPhotoPager<Asset>> | null>(null);
  const [count, setCount] = useState<number>(15);
  const [deck, setDeck] = useState<Asset[]>([]);
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [dayPickerFor, setDayPickerFor] = useState<Asset | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const listRef = useRef<FlatList<Asset | "end">>(null);
  const alive = useRef(true);
  const now = useMemo(() => new Date(), [round]);

  useEffect(() => {
    alive.current = true;
    const pager = createMemoryPhotoPager(readMemoryPhotoPage, setState);
    pagerRef.current = pager;
    void pager.reset(undefined);
    const appListener = AppState.addEventListener("change", (next) => { if (next === "active" && !composerOpen) void pager.reset(undefined); });
    return () => { alive.current = false; pager.dispose(); appListener.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 近期: keep loading (bounded) until the three-day window is covered.
  const recentLoads = useRef(0);
  useEffect(() => {
    if (random || state.loading || !state.hasNextPage || recentLoads.current >= 4) return;
    const last = state.assets[state.assets.length - 1];
    if (last && isRecentPhoto(last, now) && state.assets.filter((asset) => isRecentPhoto(asset, now)).length < count) {
      recentLoads.current += 1;
      void pagerRef.current?.loadMore();
    }
  }, [count, now, random, state.assets, state.hasNextPage, state.loading]);

  const pool = useMemo(() => random ? state.assets : state.assets.filter((asset) => isRecentPhoto(asset, now)), [now, random, state.assets]);
  useEffect(() => {
    if (state.access !== "all" && state.access !== "limited") return;
    setDeck((current) => current.length ? current : random ? photoBatch(pool, count) : pool.slice(0, count));
  }, [count, pool, random, state.access]);

  function deal(nextCount = count) {
    haptic.select();
    setCount(nextCount);
    setGenerated({});
    setIndex(0);
    setRound((value) => value + 1);
    setDeck(random ? photoBatch(pool, nextCount) : pool.slice(0, nextCount));
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }
  async function nextSet() {
    const pager = pagerRef.current;
    if (!pager) return;
    let snapshot = pager.getState();
    let next = nextPhotoSet(random ? snapshot.assets : pool, deck, count, random, snapshot.hasNextPage);
    for (let pages = 0; next.needsMore && pages < 3; pages += 1) {
      await pager.loadMore();
      snapshot = pager.getState();
      next = nextPhotoSet(random ? snapshot.assets : snapshot.assets.filter((asset) => isRecentPhoto(asset, now)), deck, count, random, snapshot.hasNextPage);
    }
    if (!alive.current) return;
    haptic.medium();
    setGenerated({});
    setIndex(0);
    setRound((value) => value + 1);
    setDeck(next.assets.length ? next.assets : deck);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }

  async function permissionAction(limited: boolean) {
    if (permissionBusy) return;
    setPermissionBusy(true);
    try {
      if (limited) await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
      else if (state.canAskAgain) await requestMemoryPhotoPermission();
      else await Linking.openSettings();
      if (alive.current) await pagerRef.current?.reset(undefined);
    } catch {
      // e.g. the build lacks the photo permission; fall back to system settings.
      void Linking.openSettings().catch(() => undefined);
    } finally { if (alive.current) setPermissionBusy(false); }
  }

  const current = deck[index] ?? null;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index !== null && first?.index !== undefined) setIndex(first.index);
  }).current;
  // Inside a Modal, Android back goes to onRequestClose: close inner layers first.
  const handleBack = () => { if (dayPickerFor) setDayPickerFor(null); else if (composerOpen) setComposerOpen(false); else onClose(); };

  // Swipe up on a photo → write about it. Gesture-handler pan runs alongside
  // the horizontal pager (Android's native pager eats JS responders).
  const openComposer = useCallback(() => { haptic.light(); setComposerOpen(true); }, []);
  const swipeUp = useMemo(() => Gesture.Pan()
    .enabled(!composerOpen)
    .activeOffsetY(-24)
    .failOffsetX([-24, 24])
    .onEnd((event) => { if (event.translationY < -60 || event.velocityY < -500) runOnJS(openComposer)(); }), [composerOpen, openComposer]);

  const denied = state.access === "undetermined" || state.access === "denied";
  const items: Array<Asset | "end"> = deck.length ? [...deck, "end"] : [];
  const generatedIds = deck.flatMap((asset) => generated[asset.id] ? [generated[asset.id]!] : []);
  const label = current ? photoDayLabel(current, now) : "";

  return <Modal animationType="slide" onRequestClose={handleBack}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} style={styles.headerButton} onPress={onClose}><Icon name="chevron-back" size={24} /></Pressable>
          <View style={styles.progress}>{deck.map((asset, slot) => <View key={asset.id} style={[styles.progressSegment, slot <= index && styles.progressSegmentOn, generated[asset.id] ? styles.progressSegmentDone : null]} />)}</View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy("每组数量", "Photos per set")} hitSlop={8} style={styles.countChip} onPress={() => deal(SET_SIZES[(SET_SIZES.indexOf(count as typeof SET_SIZES[number]) + 1) % SET_SIZES.length])}>
            <Text style={styles.countText}>{count}</Text><Icon name="chevron-down" size={13} />
          </Pressable>
        </View>
        {denied ? <View style={styles.center}>
          <Text style={styles.title}>{copy("从照片里，找回生活", "Find a moment in your photos")}</Text>
          <Text style={styles.explanation}>{copy("允许访问相册后，可在这里翻看照片。浏览不会上传，也不会删除原照片；只有确认生成回忆后才会上传。", "Allow photo access to browse here. Browsing never uploads or deletes photos. Photos are uploaded only after you confirm creating a memory.")}</Text>
          {!state.loading ? <View><PressableSurface radius={22} fill={theme.colors.accent} style={styles.primary} contentStyle={styles.primaryInner} onPress={() => void permissionAction(false)}><Text style={styles.primaryText}>{copy(state.canAskAgain ? "选择可访问的照片" : "前往设置", state.canAskAgain ? "Allow photo access" : "Open settings")}</Text></PressableSurface></View> : null}
        </View> : !deck.length ? <View style={styles.center}>
          {state.loading ? <ActivityIndicator color={theme.colors.textSecondary} /> : <Text style={styles.explanation}>{random ? copy("这里还没有可浏览的照片", "No accessible photos here yet") : copy("最近三天还没有照片", "No photos from the last three days")}</Text>}
        </View> : <GestureDetector gesture={swipeUp}><View style={styles.stage}>
          <FlatList
            key={round}
            ref={listRef}
            data={items}
            horizontal
            pagingEnabled
            scrollEnabled={!composerOpen}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item === "end" ? "end" : item.id}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
            getItemLayout={(_data, slot) => ({ length: width, offset: width * slot, index: slot })}
            renderItem={({ item, index: slot }) => item === "end"
              ? <SetEnd width={width} generatedIds={generatedIds} generatedAssets={deck.filter((asset) => generated[asset.id])} onPractice={() => onPracticeSet(generatedIds)} onNext={() => void nextSet()} />
              : <Reanimated.View entering={slot === 0 ? ZoomIn.springify().damping(14).stiffness(140) : undefined} style={[styles.photoPage, { width }]}>
                <PhotoStage asset={item} shrink={composerOpen && slot === index} maxHeight={height} />
                {generated[item.id] ? <Reanimated.View entering={ZoomIn.duration(motion.duration.enter)} style={styles.generatedBadge}><CheckMark size={16} /><Text style={styles.generatedText}>{copy("已生成", "Saved")}</Text></Reanimated.View> : null}
              </Reanimated.View>}
          />
          {state.access === "limited" ? <Pressable style={styles.limitedBanner} onPress={() => void permissionAction(true)}><Text style={styles.limitedText}>{copy("仅展示已授权照片 · 调整范围", "Showing selected photos · Manage access")}</Text></Pressable> : null}
          {current && !composerOpen ? <View style={styles.footer} pointerEvents="box-none">
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.dayChip, pressed && { opacity: 0.7 }]} onPress={() => { haptic.light(); setDayPickerFor(current); }}>
              <Icon name="calendar-outline" size={15} /><Text style={styles.dayChipText}>{label}</Text>
            </Pressable>
            {!generated[current.id] ? <Pressable accessibilityRole="button" accessibilityLabel={copy("写点什么", "Write about it")} style={({ pressed }) => [styles.swipeHint, pressed && { opacity: 0.7 }]} onPress={() => { haptic.light(); setComposerOpen(true); }}>
              <Icon name="chevron-up" size={18} /><Text style={styles.swipeHintText}>{copy("上滑，写点什么", "Swipe up to write")}</Text>
            </Pressable> : null}
          </View> : null}
        </View></GestureDetector>}
        {composerOpen && current ? <PhotoComposer
          asset={current}
          maxLength={maxTextLength}
          onClose={() => setComposerOpen(false)}
          onSubmit={async (text, title) => {
            const recordId = await onConfirm(current, text, title);
            if (!recordId || !alive.current) return false;
            haptic.success();
            setGenerated((value) => ({ ...value, [current.id]: recordId }));
            setComposerOpen(false);
            return true;
          }}
        /> : null}
      </SafeAreaView>
      {dayPickerFor ? <DayPhotos asset={dayPickerFor} onClose={() => setDayPickerFor(null)} onChoose={(asset) => {
        haptic.select();
        setDeck((value) => value.map((item, slot) => slot === index ? asset : item));
        setDayPickerFor(null);
      }} /> : null}
    </SafeAreaProvider>
    </GestureHandlerRootView>
  </Modal>;
}

function photoDayLabel(asset: Asset, now: Date): string {
  const time = photoTakenTime(asset);
  const relative = relativePhotoDay(time, now);
  if (relative) return t(`photo_flow.day.${relative}`);
  return time > 0 ? formatPhotoDate(new Date(time)) : "";
}

/** Hermes ships without CJK date names, so format CJK dates by hand. */
function formatPhotoDate(date: Date): string {
  const language = getLanguage();
  if (language.startsWith("zh") || language.startsWith("ja")) return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  return date.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" });
}

/** The photo fills the stage; when writing it shrinks to the top third. */
function PhotoStage({ asset, shrink, maxHeight }: { asset: Asset; shrink: boolean; maxHeight: number }) {
  const scale = useSharedValue(1);
  useEffect(() => { scale.value = shrink ? withSpring(0.36, motion.spring.land) : withSpring(1, motion.spring.land); }, [scale, shrink]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - scale.value) * -maxHeight * 0.34 }, { scale: scale.value }] }));
  return <Reanimated.View style={[styles.photoFrame, style]}>
    <MemoryPhotoPreview asset={asset} style={styles.photo} />
  </Reanimated.View>;
}

function PhotoComposer({ asset, maxLength, onClose, onSubmit }: {
  asset: Asset;
  maxLength: number;
  onClose: () => void;
  onSubmit: (text: string, title: string) => Promise<boolean>;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<TextInput>(null);
  const speech = useRealtimeSttInput({ value: text, onChangeText: (value) => setText(value.slice(0, maxLength)), disabled: busy, languageCode: getLanguage(), postRefinement: true });
  const translate = useSharedValue(40);
  useEffect(() => { translate.value = withTiming(0, { duration: motion.duration.enter }); }, [translate]);
  const enter = useAnimatedStyle(() => ({ transform: [{ translateY: translate.value }] }));
  const ready = Boolean(text.trim()) && speech.status === "idle" && !busy;
  const submit = useCallback(async () => {
    if (!ready) return;
    setBusy(true); setFailed(false);
    try {
      const ok = await onSubmit(text.trim(), title.trim());
      if (!ok) setFailed(true);
    } catch { setFailed(true); } finally { setBusy(false); }
  }, [onSubmit, ready, text, title]);
  void asset;
  return <KeyboardAvoidingView behavior="padding" style={styles.composerLayer} pointerEvents="box-none">
    <Reanimated.View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }, enter]}>
      <View style={styles.composerHeader}>
        <TextInput value={title} onChangeText={setTitle} editable={!busy} maxLength={80} placeholder={t("card_detail.title_optional")} style={styles.composerTitle} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} onPress={onClose}><Icon name="chevron-down" size={22} /></Pressable>
      </View>
      <TextInput ref={input} autoFocus multiline value={text} editable={!busy} maxLength={maxLength} onChangeText={speech.onChangeText} onSelectionChange={(event) => speech.onSelectionChange(event.nativeEvent.selection)} placeholder={t("card_detail.capture_placeholder")} textAlignVertical="top" style={styles.composerInput} />
      {failed ? <Text style={styles.composerError}>{t("photo_flow.create_failed")}</Text> : null}
      <View style={styles.composerToolbar}>
        <RealtimeSttButton status={speech.status} audioLevel={speech.audioLevel} disabled={busy} onPress={() => { Keyboard.dismiss(); input.current?.blur(); void speech.toggle(); }} />
        <View style={{ flex: 1 }} />
        <Text style={styles.composerCount}>{text.length}/{maxLength}</Text>
        <PressableSurface radius={20} fill={ready ? theme.colors.accent : theme.colors.surface} disabled={!ready} feedback="medium" contentStyle={styles.composerSubmit} onPress={() => void submit()}>
          {busy ? <ActivityIndicator size="small" color={theme.colors.onAccent} /> : <Text style={[styles.composerSubmitText, ready && { color: theme.colors.onAccent }]}>{t("card_detail.rewrite_action")}</Text>}
        </PressableSurface>
      </View>
    </Reanimated.View>
  </KeyboardAvoidingView>;
}

/** End of a set: what you made this round, then practice it or keep going. */
function SetEnd({ width, generatedIds, generatedAssets, onPractice, onNext }: {
  width: number;
  generatedIds: string[];
  generatedAssets: Asset[];
  onPractice: () => void;
  onNext: () => void;
}) {
  return <View style={[styles.endPage, { width }]}>
    {generatedIds.length ? <>
      <Reanimated.Text entering={FadeInDown.duration(motion.duration.enter)} style={styles.endTitle}>{t("photo_flow.end_made").replace("{count}", String(generatedIds.length))}</Reanimated.Text>
      <View style={styles.endGrid}>{generatedAssets.slice(0, 9).map((asset, slot) => <Reanimated.View key={asset.id} entering={ZoomIn.delay(slot * motion.stagger)} style={styles.endThumb}><MemoryPhotoPreview asset={asset} style={styles.endThumbImage} cover /></Reanimated.View>)}</View>
      <Reanimated.View entering={FadeIn.delay(240)} style={styles.endPrompt}>
        <Text style={styles.endQuestion}>{t("photo_flow.practice_now")}</Text>
        <View style={styles.endActions}>
          <PressableSurface radius={22} fill={theme.colors.fill2} feedback="light" contentStyle={styles.endButton} onPress={onNext}><Text style={styles.endButtonText}>{t("photo_flow.skip")}</Text></PressableSurface>
          <PressableSurface radius={22} fill={theme.colors.accent} feedback="medium" contentStyle={styles.endButton} onPress={onPractice}><Text style={[styles.endButtonText, { color: theme.colors.onAccent }]}>{t("photo_flow.start_practice")}</Text></PressableSurface>
        </View>
      </Reanimated.View>
    </> : <>
      <Text style={styles.endTitle}>{t("photo_flow.end_none")}</Text>
      <View><PressableSurface radius={22} fill={theme.colors.accent} feedback="medium" contentStyle={styles.endButton} onPress={onNext}><Text style={[styles.endButtonText, { color: theme.colors.onAccent }]}>{memoryPhotoCopy(getLanguage(), "下一组", "Next set")}</Text></PressableSurface></View>
    </>}
  </View>;
}

/** Every photo from the same day, scattered; pick one to swap in. */
function DayPhotos({ asset, onClose, onChoose }: { asset: Asset; onClose: () => void; onChoose: (asset: Asset) => void }) {
  const [photos, setPhotos] = useState<Asset[] | null>(null);
  const day = useMemo(() => new Date(photoTakenTime(asset) || Date.now()), [asset]);
  useEffect(() => {
    let active = true;
    void readMemoryPhotoPage({ day }).then((page) => { if (active) setPhotos(page.assets.length ? page.assets : [asset]); }).catch(() => { if (active) setPhotos([asset]); });
    return () => { active = false; };
  }, [asset, day]);
  return <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.dayPage}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} style={styles.headerButton} onPress={onClose}><Icon name="close" size={22} /></Pressable>
        <Text style={styles.dayTitle}>{formatPhotoDate(day)}</Text>
        <View style={styles.headerButton} />
      </View>
      {!photos ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.colors.textSecondary} /> : <FlashList
        data={photos}
        masonry
        numColumns={2}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 30 }}
        renderItem={({ item, index }) => <Pressable accessibilityRole="button" style={({ pressed }) => [styles.dayTile, item.id === asset.id && styles.dayTileCurrent, pressed && { opacity: 0.8 }]} onPress={() => onChoose(item)}>
          <MemoryPhotoPreview asset={item} cover style={{ width: "100%", aspectRatio: index % 3 === 0 ? 0.75 : index % 3 === 1 ? 1.2 : 1, borderRadius: 10 }} />
        </Pressable>}
      />}
    </SafeAreaView>
  </Modal>;
}

const styles = createStyles(() => ({
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { minHeight: 52, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  progress: { flex: 1, flexDirection: "row", gap: 3, alignItems: "center" },
  progressSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: theme.colors.border },
  progressSegmentOn: { backgroundColor: theme.colors.textSecondary },
  progressSegmentDone: { backgroundColor: theme.colors.accent },
  countChip: { minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: theme.colors.fill2, flexDirection: "row", alignItems: "center", gap: 3 },
  countText: { color: theme.colors.text, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, paddingHorizontal: 28 },
  title: { color: theme.colors.text, fontSize: 19, fontWeight: "700" },
  explanation: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 24, textAlign: "center" },
  primary: { height: 48, alignSelf: "center" },
  primaryInner: { height: 48, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.colors.onAccent, fontSize: 15, fontWeight: "700" },
  stage: { flex: 1 },
  photoPage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 10 },
  photoFrame: { width: "100%", flex: 1 },
  photo: { width: "100%", height: "100%", borderRadius: 14 },
  generatedBadge: { position: "absolute", top: 22, right: 24, minHeight: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 4 },
  generatedText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
  limitedBanner: { position: "absolute", top: 8, alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: theme.colors.surface },
  limitedText: { color: theme.colors.textSecondary, fontSize: 12 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 14, alignItems: "center", gap: 10 },
  dayChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 6 },
  dayChipText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  swipeHint: { minHeight: 36, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 4 },
  swipeHintText: { color: theme.colors.textSecondary, fontSize: 13 },
  composerLayer: { position: "absolute", left: 0, right: 0, bottom: 0, top: "34%" },
  composer: { flex: 1, paddingHorizontal: 18, paddingTop: 14, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderColor: theme.colors.border, gap: 8 },
  composerHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  composerTitle: { flex: 1, color: theme.colors.text, fontSize: 18, fontWeight: "700", paddingVertical: 4 },
  composerInput: { flex: 1, minHeight: 90, color: theme.colors.text, fontSize: 17, lineHeight: 26 },
  composerError: { color: theme.colors.danger, fontSize: 13 },
  composerToolbar: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 },
  composerCount: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  composerSubmit: { minHeight: 42, minWidth: 92, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  composerSubmitText: { color: theme.colors.textMuted, fontSize: 15, fontWeight: "700" },
  endPage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, paddingHorizontal: 24 },
  endTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
  endGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, maxWidth: 300 },
  endThumb: { width: 86, height: 86, borderRadius: 12, overflow: "hidden" },
  endThumbImage: { width: "100%", height: "100%" },
  endPrompt: { alignItems: "center", gap: 14 },
  endQuestion: { color: theme.colors.textSecondary, fontSize: 15 },
  endActions: { flexDirection: "row", gap: 12 },
  endButton: { height: 46, minWidth: 116, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  endButtonText: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  dayPage: { flex: 1, backgroundColor: theme.colors.canvas },
  dayTitle: { flex: 1, textAlign: "center", color: theme.colors.text, fontSize: 17, fontWeight: "700" },
  dayTile: { margin: 5, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: "transparent" },
  dayTileCurrent: { borderColor: theme.colors.accent },
}));
