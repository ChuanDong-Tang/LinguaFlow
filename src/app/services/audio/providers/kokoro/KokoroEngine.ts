import { emitTtsDebug } from "../ttsDebug";
import { getSelectedKokoroVoiceId } from "../ttsPreferences";
import { splitTextForSpeech } from "../webspeech/splitTextForSpeech";
import { KokoroAudioCache } from "./kokoroCache";
import { KokoroWorkerClient } from "./KokoroWorkerClient";

type KokoroDtype = "q8" | "q4";

const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const PHONE_RE = /Android|iPhone|iPod|Mobile/i;
const KOKORO_LOAD_TIMEOUT_MS = 45_000;
const KOKORO_PREWARM_WORKER_COUNT = 1;
const KOKORO_PLAYBACK_WORKER_COUNT = 2;
const KOKORO_SPEAK_INIT_TIMEOUT_MS = 12_000;

function isPhoneDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIpad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1);
  if (isIpad) return false;
  return PHONE_RE.test(ua);
}

export class KokoroEngine {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playbackRate = 1;
  private unavailable = false;
  private speakToken = 0;
  private readonly audioCache = new KokoroAudioCache();
  private prewarmPromise: Promise<void> | null = null;
  private workers: KokoroWorkerClient[] = [];
  private workersInitKey: string | null = null;
  private activeDtype: KokoroDtype | null = null;

  setPlaybackRate(rate: number): number {
    const normalized = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
    this.playbackRate = normalized;
    if (this.currentAudio) {
      this.currentAudio.playbackRate = normalized;
    }
    return normalized;
  }

  stop(): void {
    this.speakToken += 1;
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

  deactivate(): void {
    this.stop();
    this.resetWorkers();
    this.prewarmPromise = null;
  }

  async prewarm(timeoutMs: number = KOKORO_LOAD_TIMEOUT_MS): Promise<void> {
    if (this.prewarmPromise) return this.prewarmPromise;
    this.unavailable = false;
    this.prewarmPromise = this.prewarmInternal(timeoutMs)
      .then(() => {
        // keep resolved promise for no-op future prewarm calls
      })
      .catch((error) => {
        this.prewarmPromise = null;
        throw error;
      });
    return this.prewarmPromise;
  }

  private async prewarmInternal(timeoutMs: number): Promise<void> {
    if (typeof window === "undefined") return;
    if (this.unavailable) throw new Error("KOKORO_UNAVAILABLE");
    emitTtsDebug({ level: "info", stage: "prewarm", message: "TTS prewarm started." });
    await this.ensureWorkersWithTimeout(timeoutMs, KOKORO_PREWARM_WORKER_COUNT);
    emitTtsDebug({ level: "info", stage: "prewarm", message: "TTS prewarm completed." });
  }

  async speak(text: string): Promise<boolean> {
    const content = String(text ?? "").trim();
    if (!content || this.unavailable || typeof window === "undefined" || typeof Audio === "undefined") return false;

    this.speakToken += 1;
    const token = this.speakToken;
    this.stopCurrentAudio();
    try {
      const selectedVoiceId = getSelectedKokoroVoiceId();
      const chunks = this.splitForKokoro(content);
      if (!chunks.length) return false;

      if (!this.workers.length) {
        await this.ensureWorkersWithTimeout(KOKORO_SPEAK_INIT_TIMEOUT_MS, KOKORO_PLAYBACK_WORKER_COUNT);
      }
      const dtype = this.activeDtype ?? this.pickDtype();
      if (token !== this.speakToken) return false;

      const chunkBlobTasks = chunks.map((chunk, index) =>
        this.resolveChunkBlob(chunk, dtype, selectedVoiceId, index, token),
      );
      for (let i = 0; i < chunkBlobTasks.length; i += 1) {
        const blob = await chunkBlobTasks[i];
        if (token !== this.speakToken) return false;
        if (!blob) return false;
        const played = await this.playBlob(blob, token);
        if (!played) return false;
      }
      return true;
    } catch (error) {
      if (this.isExpectedPlaybackInterruption(error, token)) return false;
      emitTtsDebug({
        level: "error",
        stage: "kokoro_speak",
        message: "Kokoro speech generation failed.",
        meta: { error: String((error as Error)?.message ?? error ?? "unknown") },
      });
      return false;
    }
  }

  async prefetchTexts(texts: string[]): Promise<boolean> {
    if (this.unavailable || typeof window === "undefined") return false;
    const sourceTexts = Array.isArray(texts) ? texts : [];
    const normalizedLines = sourceTexts
      .map((text) => String(text ?? "").trim())
      .filter(Boolean);
    if (!normalizedLines.length) return true;
    try {
      await this.prewarm(KOKORO_LOAD_TIMEOUT_MS);
      if (!this.workers.length) {
        await this.ensureWorkersWithTimeout(KOKORO_SPEAK_INIT_TIMEOUT_MS, KOKORO_PLAYBACK_WORKER_COUNT);
      }
      const dtype = this.activeDtype ?? this.pickDtype();
      const voiceId = getSelectedKokoroVoiceId();
      const chunks = Array.from(
        new Set(
          normalizedLines.flatMap((line) => this.splitForKokoro(line)),
        ),
      );
      for (const chunk of chunks) {
        const cacheKey = await this.buildCacheKey(chunk, dtype, voiceId);
        const cached = await this.audioCache.get(cacheKey);
        if (cached) continue;
        const worker = this.workers[0];
        if (!worker) return false;
        const generated = await worker.generate(chunk, voiceId);
        const blob = this.float32ToWavBlob(generated.audio, generated.sampleRate);
        await this.audioCache.set(cacheKey, blob);
      }
      return true;
    } catch (error) {
      emitTtsDebug({
        level: "warn",
        stage: "kokoro_prefetch",
        message: "Kokoro prefetch failed.",
        meta: { error: String((error as Error)?.message ?? error ?? "unknown") },
      });
      return false;
    }
  }

  private stopCurrentAudio(): void {
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

  private pickDtype(): KokoroDtype {
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

    const worker = this.workers[chunkIndex % this.workers.length];
    if (!worker) return null;

    const generated = await worker.generate(chunk, voice);
    if (token !== this.speakToken) return null;

    const blob = this.float32ToWavBlob(generated.audio, generated.sampleRate);
    void this.audioCache.set(cacheKey, blob);
    return blob;
  }

  private async playBlob(blob: Blob, token: number): Promise<boolean> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = this.playbackRate;
    if (token !== this.speakToken) {
      URL.revokeObjectURL(url);
      return false;
    }
    this.currentAudio = audio;
    this.currentAudioUrl = url;

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

  private async ensureWorkersWithTimeout(
    timeoutMs: number = KOKORO_LOAD_TIMEOUT_MS,
    targetWorkerCount: number = KOKORO_PLAYBACK_WORKER_COUNT,
  ): Promise<void> {
    const preferredDtype = this.pickDtype();
    const fallbackDtypes: KokoroDtype[] = preferredDtype === "q8" ? ["q8", "q4"] : ["q4"];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < fallbackDtypes.length; attempt += 1) {
      const dtype = fallbackDtypes[attempt];
      try {
        await Promise.race([
          this.ensureWorkers(dtype, targetWorkerCount),
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
        this.resetWorkers();
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
          this.unavailable = true;
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

  private async ensureWorkers(dtype: KokoroDtype, targetWorkerCount: number): Promise<void> {
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      throw new Error("Kokoro worker is not supported");
    }

    const device: "wasm" | "webgpu" = "wasm";
    const workerCount = Math.max(1, Math.floor(targetWorkerCount || 1));
    const initKey = `${KOKORO_MODEL_ID}|${device}|${dtype}|workers:${workerCount}`;

    if (this.workers.length === workerCount && this.workersInitKey === initKey) return;

    this.resetWorkers();
    const workers = Array.from({ length: workerCount }, () => new KokoroWorkerClient());
    try {
      await Promise.all(workers.map((worker) => worker.init(KOKORO_MODEL_ID, device, dtype)));
      this.workers = workers;
      this.workersInitKey = initKey;
      this.activeDtype = dtype;
      this.unavailable = false;
    } catch (error) {
      for (const worker of workers) worker.terminate();
      this.workers = [];
      this.workersInitKey = null;
      this.activeDtype = null;
      throw error;
    }
  }

  private resetWorkers(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.workersInitKey = null;
    this.activeDtype = null;
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
}
