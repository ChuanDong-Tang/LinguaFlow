import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "../../components/Typography";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as MediaLibrary from "expo-media-library/legacy";
import { getLanguage, t } from "../../i18n";
import { theme } from "../../theme";
import { canReadMemoryPhoto, readMemoryPhotoPage, requestMemoryPhotoPermission } from "../../services/device/memoryPhotoLibrary";
import { confirmAccessiblePhoto } from "../../services/device/memoryPhotoConfirmation";
import { createMemoryPhotoPager, type PhotoPagerState } from "../../services/device/memoryPhotoPager";
import { photoBatch, nextPhotoSet } from "../../services/device/memoryPhotoPolicy";
import { memoryPhotoCopy } from "./memoryPhotoCopy";
import { useRealtimeSttInput } from "../../hooks/useRealtimeSttInput";
import { RealtimeSttButton } from "../../components/RealtimeSttButton";
import { MemoryPhotoPreview } from "./MemoryPhotoPreview";
import { MemoryDeckSettings } from "./MemoryDeckSettings";
import { memoryDeckPages } from "./memoryDeckPages";
import { memoryFanLayout } from "./memoryFanLayout";

// Mounted only after entering a photo feature, never on the ordinary home page.
export function MemoryPhotoBrowser({ day, random = false, onClose, onConfirm, maxTextLength }: {
  day?: Date;
  random?: boolean;
  onClose: () => void;
  onConfirm: (asset: MediaLibrary.Asset, text: string) => Promise<void>;
  maxTextLength: number;
}) {
  const copy = (zh: string, en: string) => memoryPhotoCopy(getLanguage(), zh, en);
  const [state, setState] = useState<PhotoPagerState<MediaLibrary.Asset>>({ assets: [], access: "undetermined", canAskAgain: true, hasNextPage: true, loading: true, error: false });
  const pagerRef = useRef<ReturnType<typeof createMemoryPhotoPager<MediaLibrary.Asset>> | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [chosen, setChosen] = useState<MediaLibrary.Asset | null>(null);
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const confirmationLock = useRef(false);
  const batchLock = useRef(false);
  const browsingRevision = useRef(0);
  const [batchBusy, setBatchBusy] = useState(false);
  const [count, setCount] = useState(15);
  const [deck, setDeck] = useState<MediaLibrary.Asset[]>([]);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(3);
  const [round, setRound] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const pages = useMemo(() => memoryDeckPages(deck, visible), [deck, visible]);
  const alive = useRef(true);
  const resetBrowser = useRef<() => Promise<void>>(async () => {});
  const dayTime = day?.getTime();
  useEffect(() => {
    alive.current = true;
    const pager = createMemoryPhotoPager(readMemoryPhotoPage, setState);
    pagerRef.current = pager;
    const reset = async () => {
      browsingRevision.current += 1;
      setDeck([]); setIndex(0); setRound(value => value + 1);
      // Keep typed words, but do not retain an unauthorized photo preview.
      if (!confirmationLock.current) setChosen(null);
      await pager.reset(dayTime === undefined ? undefined : new Date(dayTime));
    };
    resetBrowser.current = reset;
    void reset();
    const appListener = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      const selected = chosenRef.current;
      if (!selected) { void reset(); return; }
      // Microphone permission also backgrounds the app. Keep the editor when
      // the chosen photo remains authorized; revoke its preview otherwise.
      void canReadMemoryPhoto(selected).catch(() => false).then(readable => {
        if (alive.current && chosenRef.current?.id === selected.id && !readable) void reset();
      });
    });
    return () => { alive.current = false; pager.dispose(); appListener.remove(); };
  }, [dayTime]);
  useEffect(() => {
    // iOS starts a native asset fetch when observation begins. Never register
    // before authorization, even while merely showing our permission explainer.
    if (state.access !== "all" && state.access !== "limited") return;
    const listener = MediaLibrary.addListener(() => { void resetBrowser.current(); });
    return () => listener.remove();
  }, [state.access]);
  useEffect(() => {
    if (state.access !== "all" && state.access !== "limited") { setDeck([]); setIndex(0); return; }
    setDeck((current) => current.length ? current : random ? photoBatch(state.assets, count) : state.assets.slice(0, count));
  }, [state.assets, state.access, random, count]);

  async function permissionAction(limited: boolean) {
    if (permissionBusy) return;
    setPermissionBusy(true); setActionError(false);
    try {
      if (limited) await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
      else if (state.canAskAgain) await requestMemoryPhotoPermission();
      else await Linking.openSettings();
      if (alive.current) await resetBrowser.current();
    } catch { if (alive.current) setActionError(true); }
    finally { if (alive.current) setPermissionBusy(false); }
  }
  async function nextSet() {
    const pager = pagerRef.current;
    if (!pager || batchLock.current || pager.getState().loading) return;
    batchLock.current = true; setBatchBusy(true);
    const revision = browsingRevision.current;
    try {
      let snapshot = pager.getState();
      let next = nextPhotoSet(snapshot.assets, deck, count, random, snapshot.hasNextPage);
      // Bound reads per tap; duplicate-only pages can otherwise spin indefinitely.
      for (let pages = 0; next.needsMore && pages < 3; pages += 1) {
        await pager.loadMore();
        if (!alive.current || revision !== browsingRevision.current) return;
        snapshot = pager.getState();
        if (snapshot.error || snapshot.loading) return;
        next = nextPhotoSet(snapshot.assets, deck, count, random, snapshot.hasNextPage);
      }
      if (alive.current && revision === browsingRevision.current && next.assets.length) { setDeck(next.assets); setIndex(0); setRound(value => value + 1); }
    } finally { batchLock.current = false; if (alive.current) setBatchBusy(false); }
  }
  async function confirmPhoto() {
    if (!chosen || confirmationLock.current || voiceBusy) return;
    confirmationLock.current = true;
    const revision = browsingRevision.current;
    let handedOff = false;
    setConfirming(true); setActionError(false);
    try {
      await confirmAccessiblePhoto(
        () => canReadMemoryPhoto(chosen),
        () => alive.current && revision === browsingRevision.current,
        () => { handedOff = true; return onConfirm(chosen, note.trim()); },
      );
    }
    catch {
      if (alive.current) {
        setActionError(true);
        if (!handedOff) { setChosen(null); void resetBrowser.current(); }
      }
    }
    finally { confirmationLock.current = false; if (alive.current) setConfirming(false); }
  }
  if (chosen) return <Modal animationType="slide" onRequestClose={() => { if (!confirming) setChosen(null); }}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><Pressable disabled={confirming} style={styles.button} onPress={() => { setChosen(null); setActionError(false); }}><Text style={styles.text}>{t("common.cancel")}</Text></Pressable><Text style={styles.title}>{copy("留下这一刻", "Keep this moment")}</Text><View style={{ width: 44 }} /></View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled">
        <MemoryPhotoPreview asset={chosen} style={{ width: "100%", aspectRatio: 1.1, borderRadius: 22 }} />
        <PhotoNoteInput value={note} onChange={setNote} disabled={confirming} maxLength={maxTextLength} onBusyChange={setVoiceBusy} />
        <Pressable accessibilityRole="button" accessibilityLabel={copy("生成回忆", "Create memory")} accessibilityState={{ disabled: confirming || voiceBusy, busy: confirming }} disabled={confirming || voiceBusy} style={({ pressed }) => [styles.createButton, (pressed || confirming || voiceBusy) && { opacity: 0.5 }]} onPress={() => void confirmPhoto()}>{confirming ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={styles.nextSetText}>{copy("生成回忆", "Create memory")}</Text>}</Pressable>
        {actionError ? <Text style={styles.explanation}>{copy("未能完成，请重试。", "Could not finish. Please try again.")}</Text> : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
  return <Modal animationType="slide" onRequestClose={onClose}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><Pressable onPress={onClose} style={[styles.button, styles.headerSide, { alignItems: "flex-start" }]}><Text style={styles.text}>{t("common.cancel")}</Text></Pressable><Text numberOfLines={1} style={[styles.title, styles.headerTitle]}>{!random && day ? day.toLocaleDateString(getLanguage(), { month: "short", day: "numeric" }) : copy(random ? "盲盒图" : "今日照片", random ? "Photo surprise" : "Today's photos")}</Text><Text numberOfLines={1} style={[styles.muted, styles.headerSide, { textAlign: "right" }]}>{deck.length ? index < pages.length ? `${Math.min(index * visible + 1, deck.length)}–${Math.min((index + 1) * visible, deck.length)} / ${deck.length}` : "" : ""}</Text></View>
      {state.access === "undetermined" || state.access === "denied" ? <View style={styles.center}>
        <Text style={styles.title}>{copy("从照片里，找回生活", "Find a moment in your photos")}</Text>
        <Text style={styles.explanation}>{copy("允许访问相册后，可在这里翻看照片。浏览不会上传，也不会删除原照片；只有确认生成回忆后才会上传。", "Allow photo access to browse here. Browsing never uploads or deletes photos. Photos are uploaded only after you confirm creating a memory.")}</Text>
        {!state.loading ? <Pressable disabled={permissionBusy} style={styles.button} onPress={() => void permissionAction(false)}><Text style={styles.action}>{copy(state.canAskAgain ? "选择可访问的照片" : "前往设置", state.canAskAgain ? "Allow photo access" : "Open settings")}</Text></Pressable> : null}
      </View> : <>
        {state.access === "limited" ? <Pressable disabled={permissionBusy} style={styles.button} onPress={() => void permissionAction(true)}><Text style={styles.action}>{copy("仅展示已授权照片 · 调整范围", "Showing selected photos · Manage access")}</Text></Pressable> : null}
        <MemoryDeckSettings count={count} visible={visible} disabled={batchBusy || state.loading} onApply={(size, perPage) => {
          browsingRevision.current += 1;
          setCount(size); setVisible(perPage); setIndex(0); setRound(value => value + 1);
          setDeck(random ? photoBatch(state.assets, size) : state.assets.slice(0, size));
        }} />
        <View style={styles.stage} onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setStageSize(current => current.width === width && current.height === height ? current : { width, height });
        }}>
          {stageSize.width > 0 && deck.length > 0 ? <ScrollView key={`${round}:${stageSize.width}`} style={{ width: "100%" }} horizontal pagingEnabled directionalLockEnabled showsHorizontalScrollIndicator={false}
            contentOffset={{ x: index * stageSize.width, y: 0 }}
            onMomentumScrollEnd={event => setIndex(Math.max(0, Math.min(pages.length, Math.round(event.nativeEvent.contentOffset.x / stageSize.width))))}>
            {pages.map((batch, pageIndex) => <View key={pageIndex} style={[styles.spread, stageSize]} accessibilityElementsHidden={index !== pageIndex} importantForAccessibility={index === pageIndex ? "auto" : "no-hide-descendants"}>
              {batch.map((photo, slot) => {
                const fan = visible === 3;
                const offset = fan ? slot === 0 ? 0 : slot === 1 ? -1 : 1 : 0;
                const height = Math.min(visible === 1 ? 340 : visible === 2 ? 265 : 285, stageSize.height * .8);
                const layout = memoryFanLayout(stageSize.width, height);
                return <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={photo.filename}
                  onPress={() => { setChosen(photo); setActionError(false); }}
                  style={[styles.photo, { height, width: stageSize.width * (visible === 1 ? .86 : visible === 2 ? .46 : .65) },
                    fan && { position: "absolute", width: layout.width, height: layout.height, zIndex: slot === 0 ? 3 : 1, transform: [{ translateX: offset * layout.offset }, { translateY: offset ? -24 : 20 }, { rotate: `${offset * layout.angle}deg` }] }]}>
                  <MemoryPhotoPreview asset={photo} style={styles.image} cover />
                </Pressable>;
              })}
              {visible === 2 && batch.length === 1 ? <View pointerEvents="none" accessible={false} style={{ width: stageSize.width * .46 }} /> : null}
            </View>)}
            <View style={[styles.spread, stageSize]} accessibilityElementsHidden={index !== pages.length} importantForAccessibility={index === pages.length ? "auto" : "no-hide-descendants"}>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: batchBusy || state.loading, busy: batchBusy }} disabled={batchBusy || state.loading} style={({ pressed }) => [styles.nextSet, (pressed || batchBusy || state.loading) && { opacity: .7 }]} onPress={() => void nextSet()}>
                {batchBusy ? <ActivityIndicator color={theme.colors.onAccent} /> : <Text style={styles.nextSetText}>{copy("下一组", "Next set")}</Text>}
              </Pressable>
            </View>
          </ScrollView> : !state.loading ? <Text style={styles.muted}>{copy("这里还没有可浏览的照片", "No accessible photos here yet")}</Text> : null}
        </View>
      </>}
      <View style={styles.statusSlot}>
      {state.loading || permissionBusy ? <ActivityIndicator color={theme.colors.accentStrong} /> : null}
      {state.error || actionError ? <Pressable style={styles.button} onPress={() => { setActionError(false); void resetBrowser.current(); }}><Text style={styles.action}>{copy("读取失败，点此重试", "Could not load photos. Tap to retry.")}</Text></Pressable> : null}
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

// Mount only for the selected-photo editor. Leaving it tears down the existing
// STT hook, which closes the session and stops the microphone without uploading photos.
function PhotoNoteInput({ value, onChange, disabled, maxLength, onBusyChange }: {
  value: string;
  onChange: (text: string) => void;
  disabled: boolean;
  maxLength: number;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<TextInput>(null);
  const speech = useRealtimeSttInput({ value, onChangeText: text => onChange(text.slice(0, maxLength)), disabled, languageCode: getLanguage(), postRefinement: true });
  useEffect(() => { onBusyChange(speech.status !== "idle"); }, [speech.status, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  return <View style={styles.noteField}>
    <TextInput ref={input} multiline editable={!disabled} maxLength={maxLength} value={value} onChangeText={speech.onChangeText} onSelectionChange={event => speech.onSelectionChange(event.nativeEvent.selection)} placeholder={memoryPhotoCopy(getLanguage(), "想说点什么也可以…", "Add a few words, if you like…")} placeholderTextColor={theme.colors.textMuted} style={{ minHeight: 120, padding: 16, color: theme.colors.text, fontSize: 17, textAlignVertical: "top" }} />
    <RealtimeSttButton status={speech.status} audioLevel={speech.audioLevel} disabled={disabled} style={{ alignSelf: "flex-end", marginRight: 12, marginBottom: 12 }} onPress={() => { Keyboard.dismiss(); input.current?.blur(); void speech.toggle(); }} />
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.surface, paddingHorizontal: 22, paddingBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 54 },
  headerSide: { width: "26%", flexShrink: 0 },
  headerTitle: { flex: 1, textAlign: "center" },
  statusSlot: { height: 48, justifyContent: "center", alignItems: "center" },
  title: { color: theme.colors.text, fontSize: 19, fontWeight: "600" },
  text: { color: theme.colors.text, fontSize: 17 }, muted: { color: theme.colors.textMuted, fontSize: 13 },
  action: { color: theme.colors.accentStrong, fontSize: 15, fontWeight: "600" },
  button: { minHeight: 44, padding: 10, alignItems: "center", justifyContent: "center" },
  noteField: { marginTop: 20, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: 16, backgroundColor: theme.colors.surface },
  createButton: { minHeight: 52, paddingHorizontal: 24, paddingVertical: 14, marginBottom: 20, borderRadius: 16, backgroundColor: theme.colors.ink, alignItems: "center", justifyContent: "center" },
  nextSet: { minHeight: 50, minWidth: 148, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 25, backgroundColor: theme.colors.ink, alignItems: "center", justifyContent: "center" },
  nextSetText: { color: theme.colors.onAccent, fontSize: 16, fontWeight: "600" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 20 },
  explanation: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 24, textAlign: "center" },
  counts: { flexDirection: "row", justifyContent: "center", gap: 16 },
  stage: { flex: 1, minHeight: 240, marginVertical: 12, alignItems: "center", justifyContent: "center" },
  spread: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  photo: { borderRadius: 12, padding: 4, backgroundColor: theme.colors.surface, shadowColor: "#000000", shadowOpacity: .08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  image: { width: "100%", height: "100%", borderRadius: 8 },
});
