import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";

let activePlayer: AudioPlayer | null = null;
let activeStopTimer: ReturnType<typeof setInterval> | null = null;
let audioModeReady = false;
let cacheDirectoryReady = false;
let playbackRequestId = 0;
let lastCachePruneAt = 0;
let playbackState: TtsPlaybackState = {
  hasActiveAudio: false,
  status: "idle",
  playbackRate: 1,
  loopEnabled: false,
  activeNavigationKey: null,
  canNavigatePrevious: false,
  canNavigateNext: false,
};
let navigationControls: TtsNavigationControls | null = null;
const playbackSubscribers = new Set<() => void>();

const TTS_AUDIO_CACHE_MAX_BYTES = 50 * 1024 * 1024;
const TTS_AUDIO_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const TTS_AUDIO_CACHE_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const TTS_RANGE_STOP_GUARD_MS = 80;
const TTS_PLAYBACK_RATES = [0.5, 0.8, 1, 1.2, 1.5] as const;

export type TtsPlaybackRange = {
  startMs: number;
  endMs: number;
};

export type TtsAudioSource = {
  url: string;
  cacheKey?: string | null;
  playbackRange?: TtsPlaybackRange;
  navigationKey?: string | null;
};

export type TtsPlaybackState = {
  hasActiveAudio: boolean;
  status: "idle" | "playing" | "paused";
  playbackRate: number;
  loopEnabled: boolean;
  activeNavigationKey: string | null;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
};

export type TtsNavigationControls = {
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
};

export async function playTtsAudio(source: string | TtsAudioSource, playbackRange?: TtsPlaybackRange): Promise<void> {
  const requestId = playbackRequestId + 1;
  playbackRequestId = requestId;

  if (!audioModeReady) {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
    });
    audioModeReady = true;
  }

  stopActivePlayer();

  const resolvedSource = typeof source === "string"
    ? { url: source, playbackRange }
    : source;
  const audioUri = await resolveCachedTtsAudioUri(resolvedSource);
  if (requestId !== playbackRequestId) return;

  const effectivePlaybackRange = resolvedSource.playbackRange ?? playbackRange;

  const player = createAudioPlayer({ uri: audioUri }, { updateInterval: 30 });
  activePlayer = player;
  applyPlayerControls(player);
  setPlaybackState({
    hasActiveAudio: true,
    status: "playing",
    activeNavigationKey: resolvedSource.navigationKey ?? null,
  });
  if (effectivePlaybackRange) {
    const startSeconds = Math.max(0, effectivePlaybackRange.startMs / 1000);
    const stopAtMs = Math.max(
      effectivePlaybackRange.startMs,
      effectivePlaybackRange.endMs - TTS_RANGE_STOP_GUARD_MS
    );
    await player.seekTo(startSeconds, 0, 0);
    if (requestId !== playbackRequestId) {
      player.remove();
      return;
    }
    activeStopTimer = setInterval(() => {
      if (activePlayer !== player) return;
      const currentMs = player.currentStatus.currentTime * 1000;
      if (currentMs >= stopAtMs) {
        if (playbackState.loopEnabled) {
          void player.seekTo(startSeconds, 0, 0).then(() => {
            if (activePlayer === player && playbackState.status === "playing") player.play();
          });
          return;
        }
        stopTtsAudio();
      }
    }, 30);
  } else {
    activeStopTimer = setInterval(() => {
      if (activePlayer !== player) return;
      const status = player.currentStatus;
      if (status.didJustFinish && !playbackState.loopEnabled) {
        stopTtsAudio();
      }
    }, 120);
  }
  player.play();
}

export function stopTtsAudio(options: { resetControls?: boolean } = {}): void {
  playbackRequestId += 1;
  stopActivePlayer();
  if (options.resetControls) {
    setPlaybackState({
      playbackRate: 1,
      loopEnabled: false,
      activeNavigationKey: null,
    });
  }
}

export function toggleTtsPlayback(): void {
  if (!activePlayer) return;
  if (playbackState.status === "playing") {
    activePlayer.pause();
    setPlaybackState({ status: "paused" });
    return;
  }
  activePlayer.play();
  setPlaybackState({ status: "playing" });
}

export function cycleTtsPlaybackRate(): void {
  const currentIndex = TTS_PLAYBACK_RATES.findIndex((rate) => rate === playbackState.playbackRate);
  const nextRate = TTS_PLAYBACK_RATES[(currentIndex + 1) % TTS_PLAYBACK_RATES.length] ?? 1;
  if (activePlayer) activePlayer.setPlaybackRate(nextRate, "medium");
  setPlaybackState({ playbackRate: nextRate });
}

export function navigateTtsPrevious(): void {
  if (!navigationControls?.canNavigatePrevious) return;
  navigationControls.onNavigatePrevious();
}

export function navigateTtsNext(): void {
  if (!navigationControls?.canNavigateNext) return;
  navigationControls.onNavigateNext();
}

export function setTtsNavigationControls(controls: TtsNavigationControls | null): void {
  navigationControls = controls;
  setPlaybackState({
    canNavigatePrevious: controls?.canNavigatePrevious ?? false,
    canNavigateNext: controls?.canNavigateNext ?? false,
  });
}

export function toggleTtsLoop(): void {
  const loopEnabled = !playbackState.loopEnabled;
  if (activePlayer) activePlayer.loop = loopEnabled;
  setPlaybackState({ loopEnabled });
}

export function getTtsPlaybackState(): TtsPlaybackState {
  return playbackState;
}

export function subscribeTtsPlayback(listener: () => void): () => void {
  playbackSubscribers.add(listener);
  return () => playbackSubscribers.delete(listener);
}

function stopActivePlayer(): void {
  if (activeStopTimer) {
    clearInterval(activeStopTimer);
    activeStopTimer = null;
  }
  if (activePlayer) {
    activePlayer.pause();
    activePlayer.remove();
  }
  activePlayer = null;
  setPlaybackState({
    hasActiveAudio: false,
    status: "idle",
    activeNavigationKey: null,
  });
}

function applyPlayerControls(player: AudioPlayer): void {
  player.loop = playbackState.loopEnabled;
  player.setPlaybackRate(playbackState.playbackRate, "medium");
}

function setPlaybackState(next: Partial<TtsPlaybackState>): void {
  const merged = { ...playbackState, ...next };
  if (
    merged.hasActiveAudio === playbackState.hasActiveAudio &&
    merged.status === playbackState.status &&
    merged.playbackRate === playbackState.playbackRate &&
    merged.loopEnabled === playbackState.loopEnabled &&
    merged.activeNavigationKey === playbackState.activeNavigationKey &&
    merged.canNavigatePrevious === playbackState.canNavigatePrevious &&
    merged.canNavigateNext === playbackState.canNavigateNext
  ) {
    return;
  }
  playbackState = merged;
  playbackSubscribers.forEach((listener) => listener());
}

async function resolveCachedTtsAudioUri(source: TtsAudioSource): Promise<string> {
  const cacheKey = sanitizeCacheKey(source.cacheKey);
  if (!cacheKey) return source.url;

  try {
    const cacheDir = new Directory(Paths.cache, "tts");
    if (!cacheDirectoryReady) {
      cacheDir.create({ intermediates: true, idempotent: true });
      cacheDirectoryReady = true;
    }

    const cachedFile = new File(cacheDir, `${cacheKey}.mp3`);
    if (cachedFile.exists) {
      return cachedFile.uri;
    }

    await pruneTtsAudioCache(cacheDir, cachedFile.uri);

    const tempFile = new File(cacheDir, `${cacheKey}.${Date.now()}.${Math.random().toString(36).slice(2)}.download`);
    deleteFileIfExists(tempFile);
    await File.downloadFileAsync(source.url, tempFile, { idempotent: true });
    deleteFileIfExists(cachedFile);
    tempFile.move(cachedFile);
    await pruneTtsAudioCache(cacheDir, cachedFile.uri, { force: true });
    return cachedFile.uri;
  } catch {
    cacheDirectoryReady = false;
    return source.url;
  }
}

async function pruneTtsAudioCache(
  cacheDir: Directory,
  keepUri?: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const now = Date.now();
  if (!options.force && now - lastCachePruneAt < TTS_AUDIO_CACHE_PRUNE_INTERVAL_MS) return;
  lastCachePruneAt = now;

  try {
    const files = cacheDir
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.uri.endsWith(".mp3") && entry.exists)
      .map((file) => ({
        file,
        uri: file.uri,
        size: Math.max(0, file.size ?? 0),
        modifiedAt: normalizeFileTimestamp(file.modificationTime ?? undefined),
      }));

    let totalBytes = 0;
    for (const file of files) {
      totalBytes += file.size;
      if (file.uri !== keepUri && now - file.modifiedAt > TTS_AUDIO_CACHE_MAX_AGE_MS) {
        deleteFileIfExists(file.file);
        totalBytes -= file.size;
      }
    }

    if (totalBytes <= TTS_AUDIO_CACHE_MAX_BYTES) return;
    const candidates = files
      .filter((file) => file.uri !== keepUri)
      .sort((a, b) => a.modifiedAt - b.modifiedAt);
    for (const file of candidates) {
      if (totalBytes <= TTS_AUDIO_CACHE_MAX_BYTES) break;
      deleteFileIfExists(file.file);
      totalBytes -= file.size;
    }
  } catch {
    // Cache pruning is best-effort; playback should not fail because cleanup did.
  }
}

function deleteFileIfExists(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup.
  }
}

function normalizeFileTimestamp(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0;
  return value > 10_000_000_000 ? value : value * 1000;
}

function sanitizeCacheKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}
