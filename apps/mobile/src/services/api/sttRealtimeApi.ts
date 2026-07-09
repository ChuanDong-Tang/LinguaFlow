import { getAuthAccessToken } from "../auth/authHeaders";
import type { PcmAudioFrame } from "../stt/realtimeAudioSource";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

export type RealtimeSttEvent =
  | { type: "hello"; requestId: string }
  | { type: "ready"; sessionId: string }
  | { type: "partial"; text: string; detectedLanguage?: string | null; languageDetectionConfidence?: string | null; finalText?: string }
  | { type: "final"; text: string; detectedLanguage?: string | null; languageDetectionConfidence?: string | null; finalText?: string }
  | { type: "done"; text: string; detectedLanguage?: string | null; languageDetectionConfidence?: string | null }
  | { type: "error"; code: string; message: string }
  | { type: "canceled"; reason: string; errorCode?: string | null; errorDetails?: string | null };

export type RealtimeSttSession = {
  sessionId: string;
  sendFrame: (frame: PcmAudioFrame) => void;
  stop: () => void;
  close: () => void;
};

export async function openRealtimeSttSession(input: {
  frameLength: number;
  languageIdMode?: "at_start" | "continuous";
  candidateLanguages?: string[];
  onEvent: (event: RealtimeSttEvent) => void;
  onError: (error: Error) => void;
  onClose?: () => void;
}): Promise<RealtimeSttSession> {
  const sessionId = createSessionId();
  const accessToken = await getAuthAccessToken();
  const ws = new WebSocket(buildSttWsUrl(accessToken));
  ws.binaryType = "arraybuffer";

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
        input.onEvent(message);
        resolve();
        return;
      }
      if (message.type === "error") {
        clearTimeout(timeout);
        reject(new Error(message.message));
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("STT connection failed"));
    };
  });

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    try {
      input.onEvent(JSON.parse(event.data) as RealtimeSttEvent);
    } catch {
      input.onError(new Error("Invalid STT event"));
    }
  };
  ws.onerror = () => input.onError(new Error("STT connection failed"));
  ws.onclose = () => input.onClose?.();

  return {
    sessionId,
    sendFrame(frame) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(frame.pcm.buffer.slice(frame.pcm.byteOffset, frame.pcm.byteOffset + frame.pcm.byteLength));
    },
    stop() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stop" }));
        return;
      }
      ws.close();
    },
    close() {
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
