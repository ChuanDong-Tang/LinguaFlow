import { getAuthAccessToken } from "../auth/authHeaders";
import type { PcmAudioFrame } from "../stt/realtimeAudioSource";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
export const STT_INPUT_MAX_RECORDING_MS = 50_000;
const STT_STOP_RESPONSE_TIMEOUT_MS = 8_000;

export type RealtimeSttEvent =
  | { type: "hello"; requestId: string }
  | { type: "ready"; sessionId: string }
  | { type: "partial"; text: string; detectedLanguage?: string | null; languageDetectionConfidence?: string | null; finalText?: string }
  | { type: "final"; text: string; detectedLanguage?: string | null; languageDetectionConfidence?: string | null; finalText?: string; pronunciationAssessment?: PronunciationAssessment }
  | { type: "done"; text: string; detectedLanguage?: string | null; languageDetectionConfidence?: string | null; pronunciationAssessment?: PronunciationAssessment }
  | { type: "error"; code: string; message: string }
  | { type: "canceled"; reason: string; errorCode?: string | null; errorDetails?: string | null };

export type RealtimeSttSession = {
  sessionId: string;
  sendFrame: (frame: PcmAudioFrame) => void;
  stop: () => void;
  close: () => void;
};

export type PronunciationAssessment = {
  accuracyScore: number;
  pronunciationScore: number;
  completenessScore: number;
  fluencyScore: number;
  prosodyScore: number | null;
  words: Array<{ word: string; accuracyScore: number | null; errorType: string | null }>;
};

export async function openRealtimeSttSession(input: {
  frameLength: number;
  languageIdMode?: "at_start" | "continuous";
  candidateLanguages?: string[];
  pronunciationReferenceText?: string;
  autoStopAfterMs?: number;
  onAutoStop?: () => void;
  onEvent: (event: RealtimeSttEvent) => void;
  onError: (error: Error) => void;
  onClose?: () => void;
}): Promise<RealtimeSttSession> {
  const autoStopStartedAt = Date.now();
  const sessionId = createSessionId();
  const accessToken = await getAuthAccessToken();
  const ws = new WebSocket(buildSttWsUrl(accessToken));
  ws.binaryType = "arraybuffer";
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let stopResponseTimer: ReturnType<typeof setTimeout> | null = null;
  let stopRequested = false;

  const clearAutoStopTimer = () => {
    if (!autoStopTimer) return;
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  };
  const clearStopResponseTimer = () => {
    if (!stopResponseTimer) return;
    clearTimeout(stopResponseTimer);
    stopResponseTimer = null;
  };
  const clearSessionTimers = () => {
    clearAutoStopTimer();
    clearStopResponseTimer();
  };
  const requestStop = (automatic: boolean) => {
    if (stopRequested) return;
    stopRequested = true;
    clearAutoStopTimer();
    if (automatic) {
      try {
        input.onAutoStop?.();
      } catch (error) {
        input.onError(error instanceof Error ? error : new Error("STT auto-stop callback failed"));
      }
    }
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
        stopResponseTimer = setTimeout(() => ws.close(), STT_STOP_RESPONSE_TIMEOUT_MS);
      } catch (error) {
        ws.close();
        input.onError(error instanceof Error ? error : new Error("STT stop request failed"));
      }
      return;
    }
    ws.close();
  };
  const scheduleAutoStop = () => {
    const configuredMs = input.autoStopAfterMs;
    if (typeof configuredMs !== "number" || !Number.isFinite(configuredMs) || configuredMs <= 0) return;
    const remainingMs = Math.max(1, Math.floor(configuredMs) - (Date.now() - autoStopStartedAt));
    autoStopTimer = setTimeout(() => requestStop(true), remainingMs);
  };

  await new Promise<void>((resolve, reject) => {
    let ready = false;
    let startSent = false;
    const sendStart = () => {
      if (startSent || ws.readyState !== WebSocket.OPEN) return;
      startSent = true;
      ws.send(JSON.stringify({
        type: "start",
        sessionId,
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        bitsPerSample: BITS_PER_SAMPLE,
        frameLength: input.frameLength,
        languageIdMode: input.languageIdMode ?? "at_start",
        candidateLanguages: input.candidateLanguages?.slice(0, input.languageIdMode === "continuous" ? 10 : 4),
        pronunciationReferenceText: input.pronunciationReferenceText,
      }));
    };
    const timeout = setTimeout(() => {
      if (ready) return;
      ws.close();
      reject(new Error("STT connection timeout"));
    }, 10000);
    ws.onopen = () => {
      sendStart();
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: RealtimeSttEvent;
      try {
        message = JSON.parse(event.data) as RealtimeSttEvent;
      } catch {
        clearTimeout(timeout);
        ws.close();
        reject(new Error("Invalid STT event"));
        return;
      }
      if (message.type === "hello") {
        input.onEvent(message);
        sendStart();
        return;
      }
      if (message.type === "ready") {
        ready = true;
        clearTimeout(timeout);
        scheduleAutoStop();
        input.onEvent(message);
        resolve();
        return;
      }
      if (message.type === "error") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(message.message));
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("STT connection failed"));
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (!ready) reject(new Error("STT connection closed before ready"));
    };
  });

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: RealtimeSttEvent;
    try {
      message = JSON.parse(event.data) as RealtimeSttEvent;
    } catch {
      stopRequested = true;
      clearSessionTimers();
      ws.close();
      input.onError(new Error("Invalid STT event"));
      return;
    }
    if (message.type === "done" || message.type === "error" || message.type === "canceled") {
      stopRequested = true;
      clearSessionTimers();
    }
    input.onEvent(message);
  };
  ws.onerror = () => {
    stopRequested = true;
    clearSessionTimers();
    input.onError(new Error("STT connection failed"));
  };
  ws.onclose = () => {
    stopRequested = true;
    clearSessionTimers();
    input.onClose?.();
  };

  return {
    sessionId,
    sendFrame(frame) {
      if (stopRequested || ws.readyState !== WebSocket.OPEN) return;
      ws.send(frame.pcm.buffer.slice(frame.pcm.byteOffset, frame.pcm.byteOffset + frame.pcm.byteLength));
    },
    stop() {
      requestStop(false);
    },
    close() {
      stopRequested = true;
      clearSessionTimers();
      ws.close();
    },
  };
}

function buildSttWsUrl(accessToken: string | null): string {
  if (!BASE_URL) throw new Error("EXPO_PUBLIC_API_BASE_URL is not configured");
  const url = `${BASE_URL.replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/stt/realtime`;
  if (!accessToken) return url;
  return `${url}?access_token=${encodeURIComponent(accessToken)}`;
}

function createSessionId(): string {
  return `stt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
