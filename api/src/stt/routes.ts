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
import type { SttRequestLogRepository } from "@lf/core/ports/repository/SttRequestLogRepository.js";

const STT_START_TIMEOUT_MS = 10_000;
const STT_MAX_AUDIO_FRAME_BYTES = 64 * 1024;

type RealtimeStartMessage = {
  type: "start";
  sessionId: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  frameLength?: number;
  languageIdMode?: "at_start" | "continuous";
  candidateLanguages?: string[];
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
  sttRequestLogRepository?: SttRequestLogRepository;
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
    let candidateLanguages = runtimeConfig.sttRealtimeCandidateLanguages;
    let languageIdMode: "at_start" | "continuous" = "at_start";
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
      const durationMs = Date.now() - startedAt;
      if (userId && runtimeConfig.sttRequestLogEnabled) {
        await deps.sttRequestLogRepository?.create({
          requestId,
          userId,
          provider: deps.sttService.providerName,
          mode: "realtime",
          languageIdMode,
          candidateLanguages,
          detectedLanguage,
          languageDetectionConfidence,
          audioFormat: "pcm_s16le",
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
          audioBytes,
          audioDurationMs,
          billableSeconds: Math.ceil(audioDurationMs / 1000),
          transcriptChars,
          recognizedTextPresent: transcriptChars > 0,
          status: input.status,
          durationMs,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
        }).catch(() => undefined);
      }
      if (input.status !== "success") {
        await writeSystemEventLog(deps.systemEventLogRepository, {
          requestId,
          userId,
          module: "stt",
          event: "stt.realtime",
          level: "warn",
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
            durationMs,
            transcriptChars,
            recognizedTextPresent: transcriptChars > 0,
            detectedLanguage,
            languageDetectionConfidence,
            languageIdMode,
            candidateLanguages,
          },
        });
      }
    };

    const authReady = (async () => {
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
        return true;
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          await closeWithError(error.code, error.message);
          return false;
        }
        if (error instanceof AccountDisabledError || error instanceof AccountPendingDeleteError) {
          await closeWithError(error.code, error.message);
          return false;
        }
        await closeWithError("STT_AUTH_FAILED", error instanceof Error ? error.message : "STT auth failed");
        return false;
      }
    })();

    socket.on("message", (raw: Buffer | string | Buffer[], isBinary: boolean) => {
      void (async () => {
        try {
          if (!isBinary) {
            await handleTextMessage(rawToUtf8(raw));
            return;
          }
          handleAudioBuffer(rawToBuffer(raw));
        } catch (error) {
          await closeWithError("STT_SESSION_FAILED", error instanceof Error ? error.message : "STT session failed", 1011);
        }
      })();
    });

    socket.on("close", () => {
      void closeSession(sessionId
        ? { status: "success" }
        : { status: "failed", errorCode: "STT_CLIENT_CLOSED_BEFORE_START", errorMessage: "STT client closed before start." }
      );
    });
    socket.on("error", (error: Error) => {
      void closeSession({ status: "failed", errorCode: "STT_SOCKET_ERROR", errorMessage: error.message });
    });

    async function handleTextMessage(raw: string): Promise<void> {
      const message = JSON.parse(raw) as unknown;
      if (isRealtimeStartMessage(message)) {
        const authenticatedReady = await authReady;
        if (!authenticatedReady || settled) return;
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
        languageIdMode = message.languageIdMode ?? "at_start";
        candidateLanguages = normalizeCandidateLanguages(
          message.candidateLanguages,
          runtimeConfig.sttRealtimeCandidateLanguages,
          languageIdMode
        );
        sttSession = await deps.sttService.startRealtimeSession({
          sampleRate: message.sampleRate,
          channels: message.channels,
          bitsPerSample: message.bitsPerSample,
          candidateLanguages,
          languageIdMode,
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
        sendJson({ type: "done", text: finalText, detectedLanguage, languageDetectionConfidence });
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
    (v.candidateLanguages === undefined || isCandidateLanguageList(v.candidateLanguages)) &&
    (v.languageIdMode === undefined || v.languageIdMode === "at_start" || v.languageIdMode === "continuous")
  );
}

function isCandidateLanguageList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 10 &&
    value.every((item) => typeof item === "string" && /^[a-z]{2,3}-[A-Z]{2}$/.test(item))
  );
}

function normalizeCandidateLanguages(
  input: string[] | undefined,
  fallback: string[],
  languageIdMode: "at_start" | "continuous"
): string[] {
  const source = input?.length ? input : fallback;
  return Array.from(new Set(source.map((item) => item.trim()).filter(Boolean))).slice(
    0,
    languageIdMode === "continuous" ? 10 : 4
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

function rawToUtf8(raw: Buffer | string | Buffer[]): string {
  if (typeof raw === "string") return raw;
  return rawToBuffer(raw).toString("utf8");
}

function rawToBuffer(raw: Buffer | string | Buffer[]): Buffer {
  if (typeof raw === "string") return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return raw;
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
