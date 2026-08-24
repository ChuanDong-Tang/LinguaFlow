import { randomUUID } from "node:crypto";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { CardSpeechService } from "../../services/card/CardSpeechService.js";
import type { TtsStreamingCoordinator } from "../../services/tts/TtsStreamingCoordinator.js";

export class TtsStreamingWorker {
  private running = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly consumerId = `tts-streaming-${process.pid}-${randomUUID()}`;

  constructor(
    private readonly coordinator: TtsStreamingCoordinator,
    private readonly cardSpeechService: CardSpeechService,
    private readonly logs?: SystemEventLogRepository,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.coordinator.heartbeatWorker(this.consumerId).catch(() => undefined);
    this.heartbeatTimer = setInterval(() => void this.coordinator.heartbeatWorker(this.consumerId).catch(() => undefined), 10_000);
    while (this.running) {
      try {
        const claimed = await this.coordinator.claimJob(this.consumerId);
        if (!claimed) continue;
        await this.process(claimed.streamEntryId, claimed.generation);
      } catch (error) {
        if (this.running) console.error("[tts-streaming-worker] loop failed", error);
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    void this.coordinator.removeWorker(this.consumerId).catch(() => undefined);
    this.coordinator.closeClaimReader();
  }

  private async process(
    streamEntryId: string,
    generation: Awaited<ReturnType<TtsStreamingCoordinator["getGeneration"]>> & {},
  ): Promise<void> {
    const startedAt = Date.now();
    const leaseTimer = setInterval(() => {
      void this.coordinator.renewJobLease(streamEntryId, this.consumerId).catch(() => undefined);
    }, 10_000);
    let chunkWrites = Promise.resolve();
    let streamedBytes = 0;
    const maxAudioBytes = readPositiveInt(process.env.TTS_STREAMING_MAX_AUDIO_BYTES, 12 * 1024 * 1024);
    try {
      const result = await this.cardSpeechService.generateStreaming(
        generation.job,
        generation.generationId,
        (chunk) => {
          streamedBytes += chunk.length;
          if (streamedBytes > maxAudioBytes) throw new Error("TTS_STREAMING_AUDIO_TOO_LARGE");
          chunkWrites = chunkWrites.then(() => this.coordinator.appendAudioChunk(generation.generationId, chunk));
        },
      );
      await chunkWrites;
      if (!result.asset.objectUrl) throw new Error("TTS_STREAMING_ASSET_URL_MISSING");
      await this.coordinator.markReady({
        generationId: generation.generationId,
        assetId: result.asset.id,
        audioUrl: result.asset.objectUrl,
        providerTimings: result.synthesis.providerTimings,
      });
      await this.writeLog(generation, "success", null, {
        durationMs: Date.now() - startedAt,
        assetId: result.asset.id,
        audioBytes: result.synthesis.audio.length,
        providerTimings: result.synthesis.providerTimings ?? null,
      });
    } catch (error) {
      await chunkWrites.catch(() => undefined);
      const errorCode = error instanceof Error ? error.message.slice(0, 120) : "TTS_STREAMING_WORKER_FAILED";
      await this.coordinator.markFailed(generation.generationId, errorCode).catch(() => undefined);
      await this.writeLog(generation, "failed", errorCode, { durationMs: Date.now() - startedAt });
    } finally {
      clearInterval(leaseTimer);
      await this.coordinator.ackJob(streamEntryId).catch(() => undefined);
    }
  }

  private async writeLog(
    generation: NonNullable<Awaited<ReturnType<TtsStreamingCoordinator["getGeneration"]>>>,
    status: "success" | "failed",
    errorCode: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.logs?.create({
      userId: generation.userId,
      module: "tts",
      event: "tts.streaming.generation",
      level: status === "success" ? "info" : "warn",
      status,
      errorCode,
      metadata: {
        generationId: generation.generationId,
        cacheKey: generation.cacheKey,
        attempt: generation.attempt,
        sourceTextChars: generation.job.sourceText.length,
        ...metadata,
      },
    }).catch(() => undefined);
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
