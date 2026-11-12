import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { playCardTransitionSound } from "../audio/gameFeedbackAudio";
import { useSyncExternalStore } from "react";
import { alignCardSpeechMarks } from "@lf/core/text/cardSpeechText";
import { getCardArticleAudio, getCardAudioTimeline, getCardRecord, type CardRecordDetail } from "../api/cardApi";
import {
  beginTtsPlaybackSession,
  getTtsPlaybackState,
  isTtsPlaybackSessionCurrent,
  playTtsAudio,
  seekTtsPlayback,
  setTtsLoopMode,
  setTtsPlaybackLoopRange,
  stopTtsAudio,
  subscribeTtsPlayback,
  toggleTtsPlayback,
} from "../tts/ttsPlayback";
import { countCardEncounter } from "../card/cardEncounters";

// Podcast mode: play a list of memories back to back, in the background, with
// subtitles. 全篇 mode: ◁▷ move between cards. 单句循环 mode: the current
// sentence repeats and ◁▷ move between sentences.

export type PodcastPlaylist = { id: string; title: string; recordIds: string[]; coverUrl?: string | null; playedAt?: number };
export type PodcastSentence = { text: string; startMs: number; durationMs: number };
export type PodcastMode = "full" | "sentence";
export type PodcastOrder = "sequential" | "shuffle";
export type PodcastState = {
  playlist: PodcastPlaylist | null;
  queue: string[];
  index: number;
  order: PodcastOrder;
  mode: PodcastMode;
  current: { recordId: string; title: string; coverUrl: string | null; text: string; sentences: PodcastSentence[] | null } | null;
  loading: boolean;
  error: boolean;
  /** Sleep timer: stop at this time, or after the current card. */
  sleep: { endsAt: number } | { afterCard: true } | null;
};

const RECENT_KEY = "oio.podcast.recent.v1";
const NAVIGATION_PREFIX = "podcast:";
let state: PodcastState = { playlist: null, queue: [], index: 0, order: "sequential", mode: "full", current: null, loading: false, error: false, sleep: null };
const listeners = new Set<() => void>();
let sessionId = 0;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<PodcastState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function getPodcastState(): PodcastState { return state; }
export function subscribePodcast(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function usePodcast(): PodcastState { return useSyncExternalStore(subscribePodcast, getPodcastState); }

/** True while the shared player is playing podcast audio (not a card's own playback). */
export function podcastOwnsAudio(): boolean {
  return Boolean(getTtsPlaybackState().activeNavigationKey?.startsWith(NAVIGATION_PREFIX));
}

// If card playback elsewhere takes over the audio, the podcast quietly ends.
subscribeTtsPlayback(() => {
  const tts = getTtsPlaybackState();
  if (state.current && tts.hasActiveAudio && !tts.activeNavigationKey?.startsWith(NAVIGATION_PREFIX)) {
    set({ current: null, playlist: null, queue: [], loading: false });
  }
});

function shuffled<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export async function playPodcast(playlist: PodcastPlaylist, startRecordId?: string): Promise<void> {
  if (!playlist.recordIds.length) return;
  const queue = state.order === "shuffle" ? shuffled(playlist.recordIds) : [...playlist.recordIds];
  const index = startRecordId ? Math.max(0, queue.indexOf(startRecordId)) : 0;
  set({ playlist, queue, index, error: false });
  void rememberRecent(playlist);
  await playIndex(index);
}

type PreparedCard = {
  recordId: string;
  detail: CardRecordDetail;
  block: NonNullable<ReturnType<typeof primaryBlock>>;
  audio: Awaited<ReturnType<typeof getCardArticleAudio>>;
  sentences: PodcastSentence[] | null;
} | null;
const prepared = new Map<string, Promise<PreparedCard>>();

/**
 * Load a card and its finished article audio. Streaming audio is still being
 * generated and reports a growing duration (it would end early), so wait for
 * the generation to complete and fetch the finished file instead.
 */
function prepareCard(recordId: string): Promise<PreparedCard> {
  const existing = prepared.get(recordId);
  if (existing) return existing;
  const task = (async (): Promise<PreparedCard> => {
    const detail = await getCardRecord(recordId);
    const block = primaryBlock(detail);
    if (!block) return null;
    const entryId = detail.id.replace(/^card:/u, "");
    let audio = await getCardArticleAudio({ entryId, contentType: block.contentType, contentVersion: block.contentVersion });
    if (audio.deliveryMode === "streaming" && audio.generationId) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const timeline = await getCardAudioTimeline(audio.generationId).catch(() => null);
        if (timeline?.status === "ready") break;
        if (timeline?.status === "failed") return null;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      audio = await getCardArticleAudio({ entryId, contentType: block.contentType, contentVersion: block.contentVersion });
    }
    const marks = audio.sentenceMarks?.length
      ? alignCardSpeechMarks(block.segments.map((segment) => ({ id: segment.id, text: segment.text })), audio.sentenceMarks, block.languageCode, audio.deliveryMode === "streaming")
      : null;
    return { recordId, detail, block, audio, sentences: marks ? marks.map((mark) => ({ text: mark.text, startMs: mark.startMs, durationMs: mark.durationMs })) : null };
  })();
  prepared.set(recordId, task);
  task.catch(() => undefined).finally(() => { setTimeout(() => { if (prepared.get(recordId) === task) prepared.delete(recordId); }, 10 * 60_000); });
  void task.then((value) => { if (!value) prepared.delete(recordId); }, () => prepared.delete(recordId));
  return task;
}

async function playIndex(index: number): Promise<void> {
  const recordId = state.queue[index];
  if (!recordId) { stopPodcast(); return; }
  const session = beginTtsPlaybackSession({ retainBackground: true });
  sessionId = session;
  set({ index, loading: true, error: false });
  try {
    const card = await prepareCard(recordId);
    if (!isTtsPlaybackSessionCurrent(session)) return;
    if (!card) { await advance(1); return; }
    const { detail, block, audio, sentences } = card;
    const entryId = detail.id.replace(/^card:/u, "");
    const coverUrl = detail.thumbnail?.url ?? detail.images?.[0]?.url ?? null;
    const movedOn = state.current !== null && state.current.recordId !== recordId;
    set({ current: { recordId, title: detail.displayTitle || block.text.slice(0, 24), coverUrl, text: block.text, sentences }, loading: false });
    // A short cue when the next card starts, so the switch is noticeable (foreground only).
    if (movedOn && AppState.currentState === "active") {
      void playCardTransitionSound().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 380));
      if (!isTtsPlaybackSessionCurrent(session)) return;
    }
    countCardEncounter(recordId);
    // Get the next card ready while this one plays.
    const nextId = state.queue[index + 1];
    if (nextId) void prepareCard(nextId).catch(() => undefined);
    const sentenceMode = state.mode === "sentence" && Boolean(sentences?.length);
    setTtsLoopMode(sentenceMode ? "one" : "off", { persist: false });
    await playTtsAudio({
      url: audio.audioUrl,
      cacheKey: audio.deliveryMode === "streaming" ? null : ["podcast", entryId, block.contentType, block.contentVersion, audio.provider, audio.voiceCode].join("-"),
      navigationKey: `${NAVIGATION_PREFIX}${recordId}`,
      loopScope: "all",
      sessionId: session,
      loadTimeoutMs: 45_000,
      background: { title: detail.displayTitle || "OIO", artist: state.playlist?.title ?? "OIO", ...(coverUrl ? { artworkUrl: coverUrl } : {}) },
      onFinished: () => {
        if (sessionId !== session) return;
        if (state.sleep && "afterCard" in state.sleep) { stopPodcast(); return; }
        void advance(1);
      },
      onError: () => { if (sessionId === session) void advance(1); },
    });
    if (sentenceMode && sentences?.[0]) applySentenceRange(0);
  } catch {
    if (isTtsPlaybackSessionCurrent(session)) set({ loading: false, error: true });
  }
}

function primaryBlock(detail: CardRecordDetail) {
  const usable = detail.contentBlocks.filter((block) => block.segments.length && block.learningAccess !== "pro_required");
  return usable.find((block) => block.contentType === "rewrite") ?? usable.find((block) => block.contentType === "original") ?? null;
}

async function advance(step: 1 | -1): Promise<void> {
  const next = state.index + step;
  if (next < 0) return playIndex(0);
  if (next >= state.queue.length) { stopPodcast(); return; }
  return playIndex(next);
}

/** Index of the sentence under the playhead. */
export function currentSentenceIndex(positionMs = getTtsPlaybackState().positionMs): number {
  const sentences = state.current?.sentences;
  if (!sentences?.length) return -1;
  let found = 0;
  sentences.forEach((sentence, index) => { if (positionMs >= sentence.startMs) found = index; });
  return found;
}

function applySentenceRange(index: number) {
  const sentence = state.current?.sentences?.[index];
  if (!sentence) return;
  void seekTtsPlayback(sentence.startMs);
  setTtsPlaybackLoopRange({ startMs: sentence.startMs, endMs: sentence.startMs + sentence.durationMs });
}

export function podcastNext(): void {
  if (state.mode === "sentence" && state.current?.sentences?.length) {
    const index = Math.min(state.current.sentences.length - 1, currentSentenceIndex() + 1);
    applySentenceRange(index);
    return;
  }
  void advance(1);
}

export function podcastPrevious(): void {
  if (state.mode === "sentence" && state.current?.sentences?.length) {
    applySentenceRange(Math.max(0, currentSentenceIndex() - 1));
    return;
  }
  // Like music players: restart the card unless we are near its beginning.
  if (getTtsPlaybackState().positionMs > 3000) { void seekTtsPlayback(0); return; }
  void advance(-1);
}

export function playSentence(index: number): void {
  const sentence = state.current?.sentences?.[index];
  if (!sentence) return;
  if (state.mode === "sentence") applySentenceRange(index);
  else void seekTtsPlayback(sentence.startMs);
}

export function togglePodcastPlayback(): void {
  if (!podcastOwnsAudio() && state.queue.length) { void playIndex(state.index); return; }
  toggleTtsPlayback();
}

export function setPodcastMode(mode: PodcastMode): void {
  set({ mode });
  if (mode === "sentence" && state.current?.sentences?.length) {
    setTtsLoopMode("one", { persist: false });
    applySentenceRange(Math.max(0, currentSentenceIndex()));
  } else {
    setTtsLoopMode("off", { persist: false });
    setTtsPlaybackLoopRange(null);
  }
}

export function setPodcastOrder(order: PodcastOrder): void {
  if (order === state.order) return;
  const currentId = state.queue[state.index];
  const base = state.playlist?.recordIds ?? [];
  const queue = order === "shuffle"
    ? [currentId, ...shuffled(base.filter((id) => id !== currentId))].filter((id): id is string => Boolean(id))
    : [...base];
  set({ order, queue, index: Math.max(0, currentId ? queue.indexOf(currentId) : 0) });
}

/** Sleep timer: minutes from now, "card" = after this card, null = off. */
export function setPodcastSleep(option: number | "card" | null): void {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  if (option === null) { set({ sleep: null }); return; }
  if (option === "card") { set({ sleep: { afterCard: true } }); return; }
  const endsAt = Date.now() + option * 60_000;
  set({ sleep: { endsAt } });
  sleepTimer = setTimeout(() => stopPodcast(), option * 60_000);
}

export function stopPodcast(): void {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  sessionId = -1;
  if (podcastOwnsAudio()) stopTtsAudio({ resetControls: true });
  setTtsLoopMode("off", { persist: false });
  set({ current: null, playlist: null, queue: [], index: 0, loading: false, sleep: null });
}

// Recently played playlists (最近播放), newest first.
export async function loadRecentPodcasts(): Promise<PodcastPlaylist[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) as PodcastPlaylist[] : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string" && Array.isArray(item.recordIds)) : [];
  } catch { return []; }
}

async function rememberRecent(playlist: PodcastPlaylist): Promise<void> {
  const recent = await loadRecentPodcasts();
  // Keep a longer history: the podcast library sorts by 最近播放.
  const next = [{ ...playlist, recordIds: playlist.recordIds.slice(0, 60), playedAt: Date.now() }, ...recent.filter((item) => item.id !== playlist.id)].slice(0, 24);
  await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
}
