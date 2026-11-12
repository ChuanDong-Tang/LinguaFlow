import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Moon, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward, Star } from "phosphor-react-native";
import { Text } from "../../components/Typography";
import { Icon } from "../../components/Icon";
import { haptic } from "../../feedback/haptics";
import { t } from "../../i18n";
import { theme } from "../../theme";
import { createStyles } from "../../styles";
import { setCardFavorite } from "../../services/api/cardApi";
import { cycleTtsPlaybackRate, getTtsPlaybackState, seekTtsPlayback, subscribeTtsPlayback } from "../../services/tts/ttsPlayback";
import {
  currentSentenceIndex,
  playSentence,
  podcastNext,
  podcastOwnsAudio,
  podcastPrevious,
  setPodcastMode,
  setPodcastOrder,
  setPodcastSleep,
  stopPodcast,
  togglePodcastPlayback,
  usePodcast,
} from "../../services/podcast/podcastPlayer";

function useTts() { return useSyncExternalStore(subscribeTtsPlayback, getTtsPlaybackState); }

// Favorites toggled during this session (the podcast queue has no summaries).
const favoriteOverrides = new Map<string, boolean>();
function useFavorite(recordId: string | undefined) {
  const [value, setValue] = useState(recordId ? favoriteOverrides.get(recordId) ?? false : false);
  useEffect(() => { setValue(recordId ? favoriteOverrides.get(recordId) ?? false : false); }, [recordId]);
  return [value, () => {
    if (!recordId) return;
    const next = !value;
    favoriteOverrides.set(recordId, next);
    setValue(next);
    haptic.light();
    void setCardFavorite(recordId, next).catch(() => { favoriteOverrides.set(recordId, !next); setValue(!next); });
  }] as const;
}

function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Bar above the dock while a podcast is playing; tap to open the player. */
export function PodcastMiniPlayer({ bottom, onOpen }: { bottom: number; onOpen: () => void }) {
  const podcast = usePodcast();
  const tts = useTts();
  const [favorite, toggleFavorite] = useFavorite(podcast.current?.recordId);
  if (!podcast.current && !podcast.loading) return null;
  const playing = podcastOwnsAudio() && tts.status === "playing";
  const progress = tts.durationMs ? Math.min(1, tts.positionMs / tts.durationMs) : 0;
  return <Pressable accessibilityRole="button" accessibilityLabel={t("podcast.open_player")} onPress={onOpen} style={[styles.mini, { bottom }]}>
    {podcast.current?.coverUrl ? <Image source={{ uri: podcast.current.coverUrl }} style={styles.miniCover} /> : <View style={[styles.miniCover, styles.coverPlaceholder]}><Icon name="headset-outline" size={18} color={theme.colors.textMuted} /></View>}
    <View style={styles.miniText}>
      <Text numberOfLines={1} style={styles.miniTitle}>{podcast.current?.title ?? t("podcast.loading")}</Text>
      <Text numberOfLines={1} style={styles.miniList}>{podcast.playlist?.title}</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={t(favorite ? "card_detail.unfavorite" : "card_detail.favorite")} hitSlop={8} style={styles.miniButton} onPress={toggleFavorite}>
      <Star size={22} color={favorite ? theme.colors.accent : theme.colors.textSecondary} weight={favorite ? "fill" : "regular"} />
    </Pressable>
    <Pressable accessibilityRole="button" hitSlop={8} style={styles.miniButton} onPress={() => { haptic.light(); togglePodcastPlayback(); }}>
      {podcast.loading || tts.status === "loading" ? <ActivityIndicator color={theme.colors.text} /> : <Icon name={playing ? "pause" : "play"} size={24} color={theme.colors.text} />}
    </Pressable>
    <View style={styles.miniProgress}><View style={[styles.miniProgressFill, { width: `${progress * 100}%` }]} /></View>
  </Pressable>;
}

/** Full-screen player: subtitles, cover, progress and controls. */
export function PodcastPlayer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const podcast = usePodcast();
  const tts = useTts();
  const [favorite, toggleFavorite] = useFavorite(podcast.current?.recordId);
  const [sleepMenu, setSleepMenu] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const seekWidth = useRef(0);
  const rowY = useRef(new Map<number, number>());
  const playing = podcastOwnsAudio() && tts.status === "playing";
  const active = podcastOwnsAudio() ? currentSentenceIndex(tts.positionMs) : -1;
  useEffect(() => {
    const y = rowY.current.get(active);
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 120), animated: true });
  }, [active]);
  useEffect(() => { rowY.current.clear(); }, [podcast.current?.recordId]);
  // The playlist ended (or another playback took over): close the player.
  useEffect(() => { if (visible && !podcast.playlist && !podcast.loading) onClose(); }, [onClose, podcast.loading, podcast.playlist, visible]);
  const duration = podcastOwnsAudio() ? tts.durationMs ?? 0 : 0;
  const position = podcastOwnsAudio() ? tts.positionMs : 0;
  const sentenceMode = podcast.mode === "sentence";
  const sleepLabel = !podcast.sleep ? null : "afterCard" in podcast.sleep ? t("podcast.sleep_after_card") : formatMs(podcast.sleep.endsAt - Date.now());

  // A Modal is a separate native root: give it its own SafeAreaProvider, or iOS
  // reports zero insets and the header slides under the status bar.
  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaProvider>
    <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("card_detail.a11y.close")} hitSlop={8} style={styles.headerButton} onPress={onClose}><Icon name="chevron-down" size={26} /></Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.headerEyebrow}>{t("podcast.now_playing")}</Text>
          <Text numberOfLines={1} style={styles.headerTitle}>{podcast.playlist?.title ?? ""}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("podcast.stop")} hitSlop={8} style={styles.headerButton} onPress={() => { stopPodcast(); onClose(); }}><Icon name="close" size={22} color={theme.colors.textSecondary} /></Pressable>
      </View>

      <ScrollView ref={scrollRef} style={styles.lyrics} contentContainerStyle={styles.lyricsContent} showsVerticalScrollIndicator={false}>
        {podcast.loading && !podcast.current ? <ActivityIndicator style={{ marginTop: 60 }} color={theme.colors.textMuted} /> : null}
        {podcast.current?.sentences ? podcast.current.sentences.map((sentence, index) => <Pressable key={`${podcast.current?.recordId}:${index}`} onLayout={(event) => rowY.current.set(index, event.nativeEvent.layout.y)} onPress={() => { haptic.select(); playSentence(index); }} style={styles.lyricRow}>
          <Text style={[styles.lyric, index === active && styles.lyricActive]}>{sentence.text}</Text>
        </Pressable>) : podcast.current ? <Text style={styles.lyric}>{podcast.current.text}</Text> : null}
        {podcast.error ? <Text style={styles.error}>{t("podcast.error")}</Text> : null}
      </ScrollView>

      <View style={styles.panel}>
        <View style={styles.nowRow}>
          {podcast.current?.coverUrl ? <Image source={{ uri: podcast.current.coverUrl }} style={styles.nowCover} /> : <View style={[styles.nowCover, styles.coverPlaceholder]}><Icon name="headset-outline" size={22} color={theme.colors.textMuted} /></View>}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={styles.nowTitle}>{podcast.current?.title ?? ""}</Text>
            <Text style={styles.nowIndex}>{podcast.queue.length ? `${podcast.index + 1} / ${podcast.queue.length}` : ""}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t(favorite ? "card_detail.unfavorite" : "card_detail.favorite")} hitSlop={8} style={styles.utility} onPress={toggleFavorite}>
            <Star size={26} color={favorite ? theme.colors.accent : theme.colors.textSecondary} weight={favorite ? "fill" : "regular"} />
          </Pressable>
        </View>

        <Pressable style={styles.seek} onPress={(event) => {
          if (!duration || !seekWidth.current) return;
          void seekTtsPlayback((event.nativeEvent.locationX / seekWidth.current) * duration);
        }} onLayout={(event) => { seekWidth.current = event.nativeEvent.layout.width; }}>
          <View style={styles.track}><View style={[styles.trackFill, { width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%` }]} /></View>
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{formatMs(position)}</Text>
          <Text style={styles.time}>-{formatMs(Math.max(0, duration - position))}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(sentenceMode ? "podcast.previous_sentence" : "podcast.previous_card")} style={styles.side} onPress={() => { haptic.select(); podcastPrevious(); }}>
            {sentenceMode ? <View style={styles.sentenceSkip}><Icon name="chevron-back" size={24} /><Text style={styles.sentenceSkipText}>{t("podcast.sentence")}</Text></View> : <SkipBack size={32} color={theme.colors.text} weight="fill" />}
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.main} onPress={() => { haptic.light(); togglePodcastPlayback(); }}>
            {podcast.loading || tts.status === "loading" ? <ActivityIndicator color={theme.colors.onAccent} /> : <Icon name={playing ? "pause" : "play"} size={34} color={theme.colors.onAccent} />}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t(sentenceMode ? "podcast.next_sentence" : "podcast.next_card")} style={styles.side} onPress={() => { haptic.select(); podcastNext(); }}>
            {sentenceMode ? <View style={styles.sentenceSkip}><Text style={styles.sentenceSkipText}>{t("podcast.sentence")}</Text><Icon name="chevron-forward" size={24} /></View> : <SkipForward size={32} color={theme.colors.text} weight="fill" />}
          </Pressable>
        </View>

        <View style={styles.utilities}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("podcast.speed")} style={styles.utility} onPress={() => { haptic.select(); cycleTtsPlaybackRate(); }}>
            <Text style={styles.rate}>{tts.playbackRate.toFixed(1)}x</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t(podcast.order === "shuffle" ? "podcast.order_shuffle" : "podcast.order_sequential")} style={styles.utility} onPress={() => { haptic.select(); setPodcastOrder(podcast.order === "shuffle" ? "sequential" : "shuffle"); }}>
            {podcast.order === "shuffle" ? <Shuffle size={24} color={theme.colors.accent} weight="bold" /> : <Repeat size={24} color={theme.colors.textSecondary} />}
            <Text style={[styles.utilityLabel, podcast.order === "shuffle" && styles.utilityLabelOn]}>{t(podcast.order === "shuffle" ? "podcast.order_shuffle" : "podcast.order_sequential")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("podcast.loop_sentence")} disabled={!podcast.current?.sentences?.length} style={styles.utility} onPress={() => { haptic.select(); setPodcastMode(sentenceMode ? "full" : "sentence"); }}>
            <RepeatOnce size={24} color={sentenceMode ? theme.colors.accent : theme.colors.textSecondary} weight={sentenceMode ? "bold" : "regular"} />
            <Text style={[styles.utilityLabel, sentenceMode && styles.utilityLabelOn]}>{t("podcast.loop_sentence")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("podcast.sleep")} style={styles.utility} onPress={() => { haptic.select(); setSleepMenu(true); }}>
            <Moon size={24} color={podcast.sleep ? theme.colors.accent : theme.colors.textSecondary} weight={podcast.sleep ? "fill" : "regular"} />
            <Text style={[styles.utilityLabel, podcast.sleep && styles.utilityLabelOn]}>{sleepLabel ?? t("podcast.sleep")}</Text>
          </Pressable>
        </View>
      </View>

      {sleepMenu ? <Pressable style={styles.sheetBackdrop} onPress={() => setSleepMenu(false)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{t("podcast.sleep")}</Text>
          {([[15, "15"], [30, "30"], [60, "60"], ["card", null], [null, null]] as const).map(([option, minutes]) => <Pressable key={String(option)} style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: theme.colors.surfacePressed }]} onPress={() => { haptic.select(); setPodcastSleep(option); setSleepMenu(false); }}>
            <Text style={styles.sheetText}>{option === null ? t("podcast.sleep_off") : option === "card" ? t("podcast.sleep_after_card") : t("podcast.sleep_minutes").replace("{count}", minutes!)}</Text>
          </Pressable>)}
        </View>
      </Pressable> : null}
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = createStyles(() => ({
  mini: { position: "absolute", left: 12, right: 12, minHeight: 60, paddingLeft: 8, paddingRight: 6, borderRadius: 14, backgroundColor: theme.colors.surface, flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden", ...theme.shadow.float },
  miniCover: { width: 44, height: 44, borderRadius: 8 },
  coverPlaceholder: { backgroundColor: theme.colors.fill2, alignItems: "center", justifyContent: "center" },
  miniText: { flex: 1, minWidth: 0 },
  miniTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  miniList: { color: theme.colors.textMuted, fontSize: 12 },
  miniButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  miniProgress: { position: "absolute", left: 0, right: 0, bottom: 0, height: 2, backgroundColor: theme.colors.fill2 },
  miniProgressFill: { height: 2, backgroundColor: theme.colors.accent },
  page: { flex: 1, backgroundColor: theme.colors.canvas },
  header: { minHeight: 56, paddingHorizontal: 8, flexDirection: "row", alignItems: "center" },
  headerButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  headerTitleBlock: { flex: 1, alignItems: "center" },
  headerEyebrow: { color: theme.colors.textMuted, fontSize: 12 },
  headerTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  lyrics: { flex: 1 },
  lyricsContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 },
  lyricRow: { paddingVertical: 8 },
  lyric: { color: theme.colors.textMuted, fontSize: 19, lineHeight: 29, fontWeight: "500" },
  lyricActive: { color: theme.colors.text, fontWeight: "700" },
  error: { marginTop: 16, color: theme.colors.danger, fontSize: 14 },
  panel: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14, backgroundColor: theme.colors.canvas },
  nowRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  nowCover: { width: 52, height: 52, borderRadius: 10 },
  nowTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  nowIndex: { marginTop: 2, color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  seek: { marginTop: 14, height: 24, justifyContent: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: theme.colors.fill2, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: theme.colors.accent },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  controls: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-evenly" },
  side: { width: 72, height: 64, alignItems: "center", justifyContent: "center" },
  sentenceSkip: { flexDirection: "row", alignItems: "center", gap: 2 },
  sentenceSkipText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  main: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" },
  utilities: { marginTop: 10, flexDirection: "row", justifyContent: "space-between" },
  utility: { minWidth: 64, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 2 },
  utilityLabel: { color: theme.colors.textMuted, fontSize: 11 },
  utilityLabelOn: { color: theme.colors.accent, fontWeight: "600" },
  rate: { color: theme.colors.textSecondary, fontSize: 17, fontWeight: "700" },
  sheetBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.scrim, justifyContent: "flex-end" },
  sheet: { paddingTop: 12, paddingBottom: 30, borderTopLeftRadius: 16, borderTopRightRadius: 16, backgroundColor: theme.colors.surface },
  sheetTitle: { paddingHorizontal: 20, paddingBottom: 6, color: theme.colors.textMuted, fontSize: 13 },
  sheetRow: { minHeight: 52, paddingHorizontal: 20, justifyContent: "center" },
  sheetText: { color: theme.colors.text, fontSize: 16 },
}));
