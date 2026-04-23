export function splitTextForSpeech(text: string): string[] {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const parts = normalized
    .split(/(?<=[.!?。！？])\s+|\n+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length) return parts;
  return [normalized];
}

const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_DEFAULT_VOICE = "am_echo";
const KOKORO_VOICE_OPTIONS = [
  "bm_fable",
  "bf_emma",
  "am_echo",
  "af_heart",
] as const;
const KOKORO_LOAD_TIMEOUT_MS = 45_000;
const PHONE_RE = /Android|iPhone|iPod|Mobile/i;
const TTS_CACHE_DB_NAME = "linguaflow-tts-cache";
const TTS_CACHE_STORE = "audio";
const TTS_CACHE_MAX_ENTRIES = 120;
const KOKORO_VOICE_STORAGE_KEY = "linguaflow-kokoro-voice";
const TTS_SOURCE_STORAGE_KEY = "linguaflow-tts-source";
const TTS_LANGUAGE_STORAGE_KEY = "linguaflow-tts-language";
const KOKORO_PREWARM_WORKER_COUNT = 1;
const KOKORO_PLAYBACK_WORKER_COUNT = 2;
const KOKORO_SPEAK_INIT_TIMEOUT_MS = 12_000;

export const TTS_DEBUG_EVENT = "app-tts-debug";

export interface TtsDebugEventDetail {
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
}

function emitTtsDebug(detail: Omit<TtsDebugEventDetail, "at">): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent<TtsDebugEventDetail>(TTS_DEBUG_EVENT, {
      detail: { ...detail, at: new Date().toISOString() },
    }),
  );
}

export type KokoroVoiceId = (typeof KOKORO_VOICE_OPTIONS)[number];
export type TtsPlaybackSource = "kokoro" | "web";
export type TtsLanguageId = "en-US" | "en-GB" | "zh-CN" | "ja-JP";

type KokoroDtype = "q8" | "q4";

type KokoroWorkerInitRequest = {
  id: number;
  type: "init";
  modelId: string;
  device: "wasm" | "webgpu";
  dtype: KokoroDtype;
};

type KokoroWorkerGenerateRequest = {
  id: number;
  type: "generate";
  text: string;
  voice: string;
};

type KokoroWorkerRequest = KokoroWorkerInitRequest | KokoroWorkerGenerateRequest;

type KokoroWorkerInitResponse = {
  id: number;
  ok: true;
  type: "init";
};

type KokoroWorkerGenerateResponse = {
  id: number;
  ok: true;
  type: "generate";
  audio: ArrayBuffer;
  sampleRate: number;
};

type KokoroWorkerErrorResponse = {
  id: number;
  ok: false;
  type: "error";
  stage: "init" | "generate";
  error: string;
};

type KokoroWorkerResponse =
  | KokoroWorkerInitResponse
  | KokoroWorkerGenerateResponse
  | KokoroWorkerErrorResponse;

type TtsCacheRecord = {
  key: string;
  audioBlob: Blob;
  updatedAt: number;
};

const KOKORO_VOICE_SET = new Set<KokoroVoiceId>(KOKORO_VOICE_OPTIONS);
const TTS_SOURCE_SET = new Set<TtsPlaybackSource>(["kokoro", "web"]);
const TTS_LANGUAGE_SET = new Set<TtsLanguageId>(["en-US", "en-GB", "zh-CN", "ja-JP"]);

function isPhoneDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIpad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1);
  if (isIpad) return false;
  return PHONE_RE.test(ua);
}

function getDefaultPlaybackSource(): TtsPlaybackSource {
  return "web";
}

export function getSelectedTtsPlaybackSource(): TtsPlaybackSource {
  try {
    const raw = localStorage.getItem(TTS_SOURCE_STORAGE_KEY);
    if (raw && TTS_SOURCE_SET.has(raw as TtsPlaybackSource)) return raw as TtsPlaybackSource;
  } catch {
    /* ignore */
  }
  return getDefaultPlaybackSource();
}

export function setSelectedTtsPlaybackSource(source: string): TtsPlaybackSource {
  const normalized = TTS_SOURCE_SET.has(source as TtsPlaybackSource)
    ? (source as TtsPlaybackSource)
    : getDefaultPlaybackSource();
  try {
    localStorage.setItem(TTS_SOURCE_STORAGE_KEY, normalized);
  } catch {
    /* ignore */
  }
  return normalized;
}

export function getSelectedTtsLanguageId(): TtsLanguageId {
  try {
    const raw = localStorage.getItem(TTS_LANGUAGE_STORAGE_KEY);
    if (raw && TTS_LANGUAGE_SET.has(raw as TtsLanguageId)) return raw as TtsLanguageId;
  } catch {
    /* ignore */
  }
  return "en-US";
}

export function setSelectedTtsLanguageId(lang: string): TtsLanguageId {
  const normalized = TTS_LANGUAGE_SET.has(lang as TtsLanguageId)
    ? (lang as TtsLanguageId)
    : "en-US";
  try {
    localStorage.setItem(TTS_LANGUAGE_STORAGE_KEY, normalized);
  } catch {
    /* ignore */
  }
  return normalized;
}

export function getSelectedKokoroVoiceId(): KokoroVoiceId {
  try {
    const raw = localStorage.getItem(KOKORO_VOICE_STORAGE_KEY);
    if (raw && KOKORO_VOICE_SET.has(raw as KokoroVoiceId)) return raw as KokoroVoiceId;
  } catch {
    /* ignore */
  }
  return KOKORO_DEFAULT_VOICE;
}

export function setSelectedKokoroVoiceId(voiceId: string): KokoroVoiceId {
  const normalized = KOKORO_VOICE_SET.has(voiceId as KokoroVoiceId)
    ? (voiceId as KokoroVoiceId)
    : KOKORO_DEFAULT_VOICE;
  try {
    localStorage.setItem(KOKORO_VOICE_STORAGE_KEY, normalized);
  } catch {
    /* ignore */
  }
  return normalized;
}

export function listKokoroVoiceIds(): readonly KokoroVoiceId[] {
  return KOKORO_VOICE_OPTIONS;
}

class BrowserAudioCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async get(key: string): Promise<Blob | null> {
    try {
      const db = await this.openDb();
      const record = await this.readRecord(db, key);
      if (!record?.audioBlob) return null;
      void this.touch(db, key, record.audioBlob);
      return record.audioBlob;
    } catch {
      return null;
    }
  }

  async set(key: string, audioBlob: Blob): Promise<void> {
    try {
      const db = await this.openDb();
      await this.writeRecord(db, { key, audioBlob, updatedAt: Date.now() });
      await this.prune(db, TTS_CACHE_MAX_ENTRIES);
    } catch {
      /* ignore cache failures */
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(TTS_CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.createObjectStore(TTS_CACHE_STORE, { keyPath: "key" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open tts cache db"));
    });
    return this.dbPromise;
  }

  private readRecord(db: IDBDatabase, key: string): Promise<TtsCacheRecord | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TTS_CACHE_STORE, "readonly");
      const store = tx.objectStore(TTS_CACHE_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as TtsCacheRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Failed to read tts cache"));
    });
  }

  private writeRecord(db: IDBDatabase, record: TtsCacheRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TTS_CACHE_STORE, "readwrite");
      const store = tx.objectStore(TTS_CACHE_STORE);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write tts cache"));
      tx.onabort = () => reject(tx.error ?? new Error("Aborted while writing tts cache"));
    });
  }

  private touch(db: IDBDatabase, key: string, audioBlob: Blob): Promise<void> {
    return this.writeRecord(db, { key, audioBlob, updatedAt: Date.now() });
  }

  private prune(db: IDBDatabase, maxEntries: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TTS_CACHE_STORE, "readwrite");
      const store = tx.objectStore(TTS_CACHE_STORE);
      const index = store.index("updatedAt");
      const cursorReq = index.openCursor();
      const keysToDelete: string[] = [];
      let count = 0;

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          const overflow = Math.max(0, count - maxEntries);
          for (let i = 0; i < overflow; i += 1) {
            store.delete(keysToDelete[i]);
          }
          return;
        }
        count += 1;
        keysToDelete.push(String((cursor.value as TtsCacheRecord).key));
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Failed to prune tts cache"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to complete tts cache prune"));
      tx.onabort = () => reject(tx.error ?? new Error("Aborted while pruning tts cache"));
    });
  }
}

class KokoroWorkerClient {
  private readonly worker: Worker;
  private requestId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<number, { resolve: (value: KokoroWorkerResponse) => void; reject: (reason?: unknown) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./kokoroTtsWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<KokoroWorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message);
        return;
      }
      pending.reject(new Error(message.error || "Kokoro worker request failed"));
    };
    this.worker.onerror = (event: ErrorEvent) => {
      const reason = new Error(event.message || "Kokoro worker crashed");
      const pendingList = Array.from(this.pending.values());
      this.pending.clear();
      for (const pending of pendingList) {
        pending.reject(reason);
      }
    };
  }

  async init(modelId: string, device: "wasm" | "webgpu", dtype: KokoroDtype): Promise<void> {
    await this.enqueue(async () => {
      await this.request({
        id: this.nextId(),
        type: "init",
        modelId,
        device,
        dtype,
      });
    });
  }

  async generate(text: string, voice: string): Promise<{ audio: Float32Array; sampleRate: number }> {
    return this.enqueue(async () => {
      const response = await this.request({
        id: this.nextId(),
        type: "generate",
        text,
        voice,
      });
      if (response.type !== "generate") {
        throw new Error("Unexpected Kokoro worker response type");
      }
      return {
        audio: new Float32Array(response.audio),
        sampleRate: response.sampleRate,
      };
    });
  }

  terminate(): void {
    const pendingList = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of pendingList) {
      pending.reject(new Error("Kokoro worker terminated"));
    }
    this.worker.terminate();
  }

  private nextId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private request(payload: KokoroWorkerRequest): Promise<KokoroWorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(payload.id, { resolve, reject });
      this.worker.postMessage(payload);
    });
  }
}

class BrowserTtsService {
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playbackRate = 1;
  private kokoroUnavailable = false;
  private speakToken = 0;
  private readonly audioCache = new BrowserAudioCache();
  private prewarmPromise: Promise<void> | null = null;
  private kokoroWorkers: KokoroWorkerClient[] = [];
  private kokoroWorkersInitKey: string | null = null;
  private kokoroActiveDtype: KokoroDtype | null = null;

  isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return (
      ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") ||
      typeof Audio !== "undefined"
    );
  }

  stop(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.currentUtterance = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }

  setPlaybackRate(rate: number): number {
    const normalized = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
    this.playbackRate = normalized;
    if (this.currentAudio) {
      this.currentAudio.playbackRate = normalized;
    }
    if (this.currentUtterance) {
      this.currentUtterance.rate = normalized;
    }
    return normalized;
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  async speak(text: string): Promise<boolean> {
    const content = String(text ?? "").trim();
    if (!content || !this.isSupported()) return false;

    this.speakToken += 1;
    const token = this.speakToken;
    this.stop();

    if (getSelectedTtsPlaybackSource() === "web") {
      return this.speakWithBrowser(content, token);
    }

    const kokoroPlayed = await this.trySpeakWithKokoro(content, token);
    if (kokoroPlayed) return true;
    if (token !== this.speakToken) return true;
    return this.speakWithBrowser(content, token);
  }

  prewarm(): Promise<void> {
    return this.prewarmWithOptions();
  }

  setPlaybackSource(source: string): TtsPlaybackSource {
    const normalized = setSelectedTtsPlaybackSource(source);
    if (normalized === "web") {
      this.stop();
      this.resetKokoroWorkers();
      return normalized;
    }
    this.kokoroUnavailable = false;
    this.prewarmPromise = null;
    return normalized;
  }

  async switchToKokoroWithWarmup(timeoutMs: number): Promise<boolean> {
    setSelectedTtsPlaybackSource("kokoro");
    this.kokoroUnavailable = false;
    this.prewarmPromise = null;
    try {
      await this.prewarmWithOptions({ timeoutMs, force: true, throwOnFail: true });
      return true;
    } catch {
      setSelectedTtsPlaybackSource("web");
      this.stop();
      this.resetKokoroWorkers();
      emitTtsDebug({
        level: "error",
        stage: "model_switch",
        message: "Kokoro warmup failed. Reverted to Web Speech.",
        meta: { timeoutMs },
      });
      return false;
    }
  }

  private prewarmWithOptions({
    timeoutMs = KOKORO_LOAD_TIMEOUT_MS,
    force = false,
    throwOnFail = false,
  }: {
    timeoutMs?: number;
    force?: boolean;
    throwOnFail?: boolean;
  } = {}): Promise<void> {
    if (!force && this.prewarmPromise) return this.prewarmPromise;
    const task = (async () => {
      if (getSelectedTtsPlaybackSource() !== "kokoro") return;
      if (this.kokoroUnavailable || typeof window === "undefined") return;
      try {
        emitTtsDebug({ level: "info", stage: "prewarm", message: "TTS prewarm started." });
        await this.ensureKokoroWorkersWithTimeout(timeoutMs, KOKORO_PREWARM_WORKER_COUNT);
        emitTtsDebug({ level: "info", stage: "prewarm", message: "TTS prewarm completed." });
      } catch {
        emitTtsDebug({
          level: "error",
          stage: "prewarm",
          message: "TTS prewarm failed.",
          meta: { timeoutMs },
        });
        if (throwOnFail) {
          throw new Error("KOKORO_PREWARM_FAILED");
        }
      }
    })();
    this.prewarmPromise = task;
    return task;
  }

  private async trySpeakWithKokoro(content: string, token: number): Promise<boolean> {
    if (this.kokoroUnavailable || typeof window === "undefined" || typeof Audio === "undefined") return false;
    try {
      const selectedVoiceId = getSelectedKokoroVoiceId();
      const chunks = this.splitForKokoro(content);
      if (!chunks.length) return false;

      // Prefer first-audio latency: if prewarm already prepared workers, start speaking immediately.
      // We avoid blocking on worker upscaling during the click-to-play path.
      if (!this.kokoroWorkers.length) {
        await this.ensureKokoroWorkersWithTimeout(KOKORO_SPEAK_INIT_TIMEOUT_MS, KOKORO_PLAYBACK_WORKER_COUNT);
      }
      const dtype = this.kokoroActiveDtype ?? this.pickKokoroDtype();
      if (token !== this.speakToken) return false;

      const chunkBlobTasks = chunks.map((chunk, index) => this.resolveChunkBlob(chunk, dtype, selectedVoiceId, index, token));

      for (let i = 0; i < chunkBlobTasks.length; i += 1) {
        const blob = await chunkBlobTasks[i];
        if (token !== this.speakToken) return false;
        if (!blob) return false;
        const played = await this.playBlob(blob, token, "ended");
        if (!played) return false;
      }
      return true;
    } catch (error) {
      if (this.isExpectedPlaybackInterruption(error, token)) {
        return false;
      }
      emitTtsDebug({
        level: "error",
        stage: "kokoro_speak",
        message: "Kokoro speech generation failed.",
        meta: { error: String((error as Error)?.message ?? error ?? "unknown") },
      });
      return false;
    }
  }

  private async resolveChunkBlob(
    chunk: string,
    dtype: KokoroDtype,
    voice: string,
    chunkIndex: number,
    token: number,
  ): Promise<Blob | null> {
    const cacheKey = await this.buildCacheKey(chunk, dtype, voice);
    if (token !== this.speakToken) return null;

    const cached = await this.audioCache.get(cacheKey);
    if (cached) return cached;
    if (token !== this.speakToken) return null;

    const worker = this.kokoroWorkers[chunkIndex % this.kokoroWorkers.length];
    if (!worker) return null;

    const generated = await worker.generate(chunk, voice);
    if (token !== this.speakToken) return null;

    const blob = this.float32ToWavBlob(generated.audio, generated.sampleRate);
    void this.audioCache.set(cacheKey, blob);
    return blob;
  }

  private splitForKokoro(content: string): string[] {
    const sentences = splitTextForSpeech(content);
    const out: string[] = [];
    const maxChars = 160;
    for (const sentence of sentences) {
      const normalized = sentence.trim();
      if (!normalized) continue;
      if (normalized.length <= maxChars) {
        out.push(normalized);
        continue;
      }
      const words = normalized.split(/\s+/).filter(Boolean);
      let buffer = "";
      for (const word of words) {
        const next = buffer ? `${buffer} ${word}` : word;
        if (next.length <= maxChars) {
          buffer = next;
          continue;
        }
        if (buffer) out.push(buffer);
        buffer = word;
      }
      if (buffer) out.push(buffer);
    }
    return out.length ? out : [content];
  }

  private pickKokoroDtype(): KokoroDtype {
    return isPhoneDevice() ? "q4" : "q8";
  }

  private async buildCacheKey(content: string, dtype: KokoroDtype, voice: string): Promise<string> {
    const raw = `${KOKORO_MODEL_ID}|${dtype}|${voice}|${content}`;
    if (!(globalThis.crypto?.subtle && typeof TextEncoder !== "undefined")) return raw;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return `sha256:${hex}`;
  }

  private async playBlob(blob: Blob, token: number, waitMode: "start" | "ended"): Promise<boolean> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = this.playbackRate;
    if (token !== this.speakToken) {
      URL.revokeObjectURL(url);
      return false;
    }
    this.currentAudio = audio;
    this.currentAudioUrl = url;
    if (waitMode === "start") {
      audio.onended = () => this.clearAudioRef(audio, url);
      audio.onerror = () => {
        // User-triggered interruption (token changed) is expected and should not spam error debug.
        if (token === this.speakToken) {
          emitTtsDebug({
            level: "warn",
            stage: "audio_playback",
            message: "Audio element playback interrupted before completion.",
          });
        }
        this.clearAudioRef(audio, url);
      };
      try {
        await audio.play();
      } catch (error) {
        if (!this.isExpectedPlaybackInterruption(error, token)) {
          emitTtsDebug({
            level: "error",
            stage: "audio_playback",
            message: "Audio playback start failed.",
            meta: { error: String((error as Error)?.message ?? error ?? "unknown") },
          });
        }
        this.clearAudioRef(audio, url);
        return false;
      }
      return true;
    }

    const ended = new Promise<boolean>((resolve) => {
      audio.onended = () => {
        this.clearAudioRef(audio, url);
        resolve(true);
      };
      audio.onerror = () => {
        if (token === this.speakToken) {
          emitTtsDebug({
            level: "error",
            stage: "audio_playback",
            message: "Audio element playback error.",
          });
        } else {
          emitTtsDebug({
            level: "warn",
            stage: "audio_playback",
            message: "Audio playback was interrupted by a newer request.",
          });
        }
        this.clearAudioRef(audio, url);
        resolve(false);
      };
    });
    try {
      await audio.play();
    } catch (error) {
      if (!this.isExpectedPlaybackInterruption(error, token)) {
        emitTtsDebug({
          level: "error",
          stage: "audio_playback",
          message: "Audio playback start failed.",
          meta: { error: String((error as Error)?.message ?? error ?? "unknown") },
        });
      }
      this.clearAudioRef(audio, url);
      return false;
    }
    return ended;
  }

  private isExpectedPlaybackInterruption(error: unknown, token: number): boolean {
    if (token !== this.speakToken) return true;
    const message = String((error as Error)?.message ?? error ?? "").toLowerCase();
    if (!message) return false;
    return (
      message.includes("aborterror") ||
      message.includes("operation was aborted") ||
      message.includes("play() request was interrupted") ||
      message.includes("interrupted by a call to pause")
    );
  }

  private clearAudioRef(audio: HTMLAudioElement, url: string): void {
    if (this.currentAudio === audio) {
      this.currentAudio = null;
    }
    if (this.currentAudioUrl === url) {
      URL.revokeObjectURL(url);
      this.currentAudioUrl = null;
    } else {
      URL.revokeObjectURL(url);
    }
  }

  private async ensureKokoroWorkersWithTimeout(
    timeoutMs: number = KOKORO_LOAD_TIMEOUT_MS,
    targetWorkerCount: number = KOKORO_PLAYBACK_WORKER_COUNT,
  ): Promise<void> {
    const preferredDtype = this.pickKokoroDtype();
    const fallbackDtypes: KokoroDtype[] = preferredDtype === "q8" ? ["q8", "q4"] : ["q4"];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < fallbackDtypes.length; attempt += 1) {
      const dtype = fallbackDtypes[attempt];
      try {
        await Promise.race([
          this.ensureKokoroWorkers(dtype, targetWorkerCount),
          new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error("KOKORO_LOAD_TIMEOUT")), timeoutMs);
          }),
        ]);
        if (attempt > 0) {
          emitTtsDebug({
            level: "warn",
            stage: "model_load",
            message: "Kokoro loaded with fallback dtype.",
            meta: { dtype, attempt: attempt + 1 },
          });
        }
        return;
      } catch (error) {
        lastError = error;
        const message = String((error as Error)?.message ?? "unknown");
        this.resetKokoroWorkers();
        if (attempt < fallbackDtypes.length - 1) {
          emitTtsDebug({
            level: "warn",
            stage: "model_load",
            message: "Kokoro load attempt failed. Retrying with fallback dtype.",
            meta: { dtype, attempt: attempt + 1, timeoutMs, targetWorkerCount, error: message },
          });
          continue;
        }

        if (message.includes("KOKORO_LOAD_TIMEOUT")) {
          this.kokoroUnavailable = true;
          emitTtsDebug({
            level: "error",
            stage: "model_load",
            message: "Kokoro model load timed out.",
            meta: { timeoutMs, dtype, targetWorkerCount },
          });
        } else {
          emitTtsDebug({
            level: "error",
            stage: "model_load",
            message: "Kokoro model load failed.",
            meta: { dtype, targetWorkerCount, error: message || "unknown" },
          });
        }
      }
    }
    throw lastError ?? new Error("KOKORO_LOAD_FAILED");
  }

  private async ensureKokoroWorkers(dtype: KokoroDtype, targetWorkerCount: number): Promise<void> {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      throw new Error("Kokoro worker is not supported");
    }

    const device: "wasm" | "webgpu" = "wasm";
    const workerCount = Math.max(1, Math.floor(targetWorkerCount || 1));
    const initKey = `${KOKORO_MODEL_ID}|${device}|${dtype}|workers:${workerCount}`;

    if (this.kokoroWorkers.length === workerCount && this.kokoroWorkersInitKey === initKey) {
      return;
    }

    this.resetKokoroWorkers();
    const workers = Array.from({ length: workerCount }, () => new KokoroWorkerClient());
    try {
      await Promise.all(workers.map((worker) => worker.init(KOKORO_MODEL_ID, device, dtype)));
      this.kokoroWorkers = workers;
      this.kokoroWorkersInitKey = initKey;
      this.kokoroActiveDtype = dtype;
      this.kokoroUnavailable = false;
    } catch (error) {
      for (const worker of workers) {
        worker.terminate();
      }
      this.kokoroWorkers = [];
      this.kokoroWorkersInitKey = null;
      this.kokoroActiveDtype = null;
      throw error;
    }
  }

  private resetKokoroWorkers(): void {
    for (const worker of this.kokoroWorkers) {
      worker.terminate();
    }
    this.kokoroWorkers = [];
    this.kokoroWorkersInitKey = null;
    this.kokoroActiveDtype = null;
  }

  private speakWithBrowser(content: string, token: number): Promise<boolean> {
    if (!(typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined")) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.lang = getSelectedTtsLanguageId();
      utterance.rate = this.playbackRate;
      utterance.pitch = 1;
      utterance.volume = 1;
      const englishVoice = this.pickEnglishVoice();
      if (englishVoice) utterance.voice = englishVoice;
      const finish = (played: boolean) => {
        if (this.currentUtterance === utterance) {
          this.currentUtterance = null;
        }
        resolve(played);
      };
      utterance.onend = () => {
        finish(true);
      };
      utterance.onerror = () => {
        if (token !== this.speakToken) {
          finish(false);
          return;
        }
        finish(false);
      };
      this.currentUtterance = utterance;
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        finish(false);
      }
    });
  }

  private float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    this.writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    this.writeAscii(view, 8, "WAVE");
    this.writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    this.writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(pcm), true);
      offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  private writeAscii(view: DataView, offset: number, text: string): void {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  private pickEnglishVoice(): SpeechSynthesisVoice | null {
    if (!(typeof window !== "undefined" && "speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ?? voices[0] ?? null;
  }
}

const browserTtsService = new BrowserTtsService();

export function getBrowserTtsService(): BrowserTtsService {
  return browserTtsService;
}
