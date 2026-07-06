import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { SttService } from "@lf/server/services/stt/SttService.js";
import {
  AccountDisabledError,
  AccountPendingDeleteError,
  resolveActiveUserContext,
  UnauthorizedError,
} from "../auth/userContext.js";
import type { SystemEventLogWriter } from "../lib/systemEventLog.js";
import { writeSystemEventLog } from "../lib/systemEventLog.js";
import { getRuntimeConfig } from "@lf/server/config/runtimeConfig.js";

const STT_START_TIMEOUT_MS = 10_000;
const STT_MAX_AUDIO_FRAME_BYTES = 64 * 1024;

type RealtimeStartMessage = {
  type: "start";
  sessionId: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  frameLength?: number;
  languageIdMode?: "at_start";
};

export interface SttRouteDeps {
  sttService: SttService;
  userRepository: {
    findById: (userId: string) => Promise<{
      id: string;
      status: "active" | "disabled" | "pending_delete";
    } | null>;
  };
  systemEventLogRepository?: SystemEventLogWriter;
  rateLimiter: {
    consume: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  };
}

export function registerSttRoutes(app: FastifyInstance, deps: SttRouteDeps): void {
  const runtimeConfig = getRuntimeConfig();

  app.get("/stt/realtime", { websocket: true }, (socket, req) => {
    const startedAt = Date.now();
    const requestId = firstHeaderValue(req.headers["x-request-id"]) || randomUUID();
    const query = (req.query ?? {}) as Partial<{ access_token: string }>;
    const authorization = firstHeaderValue(req.headers.authorization) || (
      query.access_token ? `Bearer ${query.access_token}` : undefined
    );
    let userId: string | null = null;
    let sessionId: string | null = null;
    let sttSession: Awaited<ReturnType<SttService["startRealtimeSession"]>> | null = null;
    let audioBytes = 0;
    let transcriptChars = 0;
    let finalText = "";
    let detectedLanguage: string | null = null;
    let languageDetectionConfidence: string | null = null;
    let settled = false;
    let authenticated = false;
    let maxSessionTimer: ReturnType<typeof setTimeout> | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;

    const sendJson = (message: Record<string, unknown>) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(message));
    };

    const closeWithError = async (code: string, message: string, status = 1008) => {
      sendJson({ type: "error", code, message });
      await closeSession({ status: "failed", errorCode: code, errorMessage: message });
      socket.close(status, code);
    };

    const closeSession = async (input: {
      status: "success" | "failed";
      errorCode?: string | null;
      errorMessage?: string | null;
    }) => {
      if (settled) return;
      settled = true;
      if (maxSessionTimer) {
        clearTimeout(maxSessionTimer);
        maxSessionTimer = null;
      }
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = null;
      }
      try {
        const stopped = await sttSession?.stop();
        if (stopped?.finalText) {
          finalText = stopped.finalText;
          transcriptChars = finalText.length;
        }
      } catch {
        sttSession?.close();
      }
      const audioDurationMs = estimatePcmDurationMs(audioBytes, 16000, 1, 16);
      await writeSystemEventLog(deps.systemEventLogRepository, {
        requestId,
        userId,
        module: "stt",
        event: "stt.realtime",
        level: input.status === "success" ? "info" : "warn",
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: {
          path: "/stt/realtime",
          provider: deps.sttService.providerName,
          mode: "realtime",
          sessionId,
          audioFormat: "pcm_s16le",
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
          audioBytes,
          audioDurationMs,
          billableSeconds: Math.ceil(audioDurationMs / 1000),
          durationMs: Date.now() - startedAt,
          transcriptChars,
          recognizedTextPresent: transcriptChars > 0,
          detectedLanguage,
          languageDetectionConfidence,
          languageIdMode: "at_start",
        },
      });
    };

    void (async () => {
      try {
        const userContext = await resolveActiveUserContext({
          authorization,
          userRepository: deps.userRepository,
        });
        userId = userContext.userId;
        const rateLimit = await consumeSttRateLimit(deps.rateLimiter, userId, {
          globalLimit: runtimeConfig.sttRealtimeGlobalRateLimit,
          userLimit: runtimeConfig.sttRealtimeUserRateLimit,
          windowMs: runtimeConfig.sttRealtimeRateWindowMs,
        });
        if (!rateLimit.allowed) {
          await closeWithError(rateLimit.code, "Too many STT sessions. Please try again later.");
          return;
        }
        authenticated = true;
        sendJson({ type: "hello", requestId });
        startTimer = setTimeout(() => {
          void closeWithError("STT_START_TIMEOUT", "STT session did not start in time.");
        }, STT_START_TIMEOUT_MS);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          await closeWithError(error.code, error.message);
          return;
        }
        if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
          await closeWithError(error.code, error.message);
          return;
        }
        await closeWithError("STT_AUTH_FAILED", error instanceof Error ? error.message : "STT auth failed");
      }
    })();

    socket.on("message", (raw: Buffer | string | Buffer[]) => {
      void (async () => {
        try {
          if (typeof raw === "string") {
            await handleTextMessage(raw);
            return;
          }
          if (raw instanceof Buffer) {
            handleAudioBuffer(raw);
            return;
          }
          if (Array.isArray(raw)) {
            handleAudioBuffer(Buffer.concat(raw));
          }
        } catch (error) {
          await closeWithError("STT_SESSION_FAILED", error instanceof Error ? error.message : "STT session failed", 1011);
        }
      })();
    });

    socket.on("close", () => {
      void closeSession({ status: "success" });
    });
    socket.on("error", (error: Error) => {
      void closeSession({ status: "failed", errorCode: "STT_SOCKET_ERROR", errorMessage: error.message });
    });

    async function handleTextMessage(raw: string): Promise<void> {
      const message = JSON.parse(raw) as unknown;
      if (isRealtimeStartMessage(message)) {
        if (!authenticated || !userId) {
          await closeWithError("STT_NOT_AUTHENTICATED", "STT session is not authenticated.");
          return;
        }
        if (sttSession) return;
        if (startTimer) {
          clearTimeout(startTimer);
          startTimer = null;
        }
        sessionId = message.sessionId;
        sttSession = await deps.sttService.startRealtimeSession({
          sampleRate: message.sampleRate,
          channels: message.channels,
          bitsPerSample: message.bitsPerSample,
          candidateLanguages: runtimeConfig.sttRealtimeCandidateLanguages,
          languageIdMode: message.languageIdMode ?? "at_start",
          onEvent: (event) => {
            if (event.type === "partial" || event.type === "final") {
              if (event.detectedLanguage) detectedLanguage = event.detectedLanguage;
              if (event.languageDetectionConfidence) languageDetectionConfidence = event.languageDetectionConfidence;
              if (event.type === "final") {
                finalText = joinTranscript(finalText, event.text);
                transcriptChars = finalText.length;
              }
              sendJson({ ...event, finalText });
              return;
            }
            sendJson(event);
            if (event.type === "canceled") {
              void closeWithError(
                "STT_PROVIDER_CANCELED",
                event.errorDetails || "STT provider canceled the session.",
                1011
              );
            }
          },
        });
        maxSessionTimer = setTimeout(() => {
          void closeWithError("STT_SESSION_TOO_LONG", "STT session exceeded max duration.");
        }, runtimeConfig.sttRealtimeMaxSessionMs);
        sendJson({ type: "ready", sessionId });
        return;
      }
      if (isStopMessage(message)) {
        await closeSession({ status: "success" });
        sendJson({ type: "done", text: finalText, detectedLanguage });
        socket.close(1000, "done");
      }
    }

    function handleAudioBuffer(buffer: Buffer): void {
      if (!sttSession) return;
      if (buffer.byteLength > STT_MAX_AUDIO_FRAME_BYTES) {
        void closeWithError("STT_AUDIO_FRAME_TOO_LARGE", "STT audio frame is too large.");
        return;
      }
      audioBytes += buffer.byteLength;
      sttSession.write(toArrayBuffer(buffer));
      const audioDurationMs = estimatePcmDurationMs(audioBytes, 16000, 1, 16);
      if (audioDurationMs > runtimeConfig.sttRealtimeMaxSessionMs + 1000) {
        void closeWithError("STT_SESSION_TOO_LONG", "STT session exceeded max duration.");
      }
    }
  });
}

function isRealtimeStartMessage(value: unknown): value is RealtimeStartMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "start" &&
    typeof v.sessionId === "string" &&
    v.sessionId.trim().length > 0 &&
    v.sessionId.length <= 120 &&
    v.sampleRate === 16000 &&
    v.channels === 1 &&
    v.bitsPerSample === 16 &&
    (v.languageIdMode === undefined || v.languageIdMode === "at_start")
  );
}

function isStopMessage(value: unknown): value is { type: "stop" } {
  return !!value && typeof value === "object" && (value as Record<string, unknown>).type === "stop";
}

function estimatePcmDurationMs(bytes: number, sampleRate: number, channels: number, bitsPerSample: number): number {
  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  if (bytesPerSecond <= 0) return 0;
  return Math.round((bytes / bytesPerSecond) * 1000);
}

function joinTranscript(current: string, next: string): string {
  const text = next.trim();
  if (!text) return current;
  if (!current) return text;
  return `${current}${/[。！？.!?]$/.test(current) ? " " : " "}${text}`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

async function consumeSttRateLimit(
  rateLimiter: SttRouteDeps["rateLimiter"],
  userId: string,
  config: {
    globalLimit: number;
    userLimit: number;
    windowMs: number;
  }
): Promise<
  | { allowed: true }
  | { allowed: false; code: "STT_GLOBAL_RATE_LIMITED" | "STT_USER_RATE_LIMITED" }
> {
  const bucket = Math.floor(Date.now() / config.windowMs);
  const globalAllowed = await rateLimiter.consume(`stt:realtime:global:${bucket}`, config.globalLimit, config.windowMs);
  if (!globalAllowed) return { allowed: false, code: "STT_GLOBAL_RATE_LIMITED" };
  const userAllowed = await rateLimiter.consume(`stt:realtime:user:${userId}:${bucket}`, config.userLimit, config.windowMs);
  if (!userAllowed) return { allowed: false, code: "STT_USER_RATE_LIMITED" };
  return { allowed: true };
}
