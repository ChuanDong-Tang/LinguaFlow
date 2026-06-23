import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";

let activePlayer: AudioPlayer | null = null;
let activeStopTimer: ReturnType<typeof setInterval> | null = null;
let audioModeReady = false;
let cacheDirectoryReady = false;
let playbackRequestId = 0;
let lastCachePruneAt = 0;

const TTS_AUDIO_CACHE_MAX_BYTES = 50 * 1024 * 1024;
const TTS_AUDIO_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const TTS_AUDIO_CACHE_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

export type TtsPlaybackRange = {
  startMs: number;
  endMs: number;
};

export type TtsAudioSource = {
  url: string;
  cacheKey?: string | null;
  playbackRange?: TtsPlaybackRange;
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

  const player = createAudioPlayer({ uri: audioUri }, { updateInterval: 100 });
  activePlayer = player;
  if (effectivePlaybackRange) {
    const startSeconds = Math.max(0, effectivePlaybackRange.startMs / 1000);
    await player.seekTo(startSeconds, 0, 0);
    if (requestId !== playbackRequestId) {
      player.remove();
      return;
    }
    activeStopTimer = setInterval(() => {
      if (activePlayer !== player) return;
      const currentMs = player.currentStatus.currentTime * 1000;
      if (currentMs >= effectivePlaybackRange.endMs) {
        stopTtsAudio();
      }
    }, 80);
  }
  player.play();
}

export function stopTtsAudio(): void {
  playbackRequestId += 1;
  stopActivePlayer();
}

function stopActivePlayer(): void {
  if (activeStopTimer) {
    clearInterval(activeStopTimer);
    activeStopTimer = null;
  }
  if (!activePlayer) return;
  activePlayer.pause();
  activePlayer.remove();
  activePlayer = null;
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
