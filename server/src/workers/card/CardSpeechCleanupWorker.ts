import type { CardRepository } from "@lf/core/ports/repository/CardRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { TtsStorageProvider } from "../../services/tts/TtsStorageProvider.js";

export class CardSpeechCleanupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: CardRepository,
    private readonly storage: TtsStorageProvider,
    private readonly options: { intervalMs?: number; batchSize?: number; dictionaryRetentionMs?: number } = {},
    private readonly systemEventLogRepository?: SystemEventLogRepository,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 60 * 60 * 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    let deletedRows = 0;
    let failedRows = 0;
    let roundFailed = false;
    try {
      const staleDictionaryBefore = new Date(Date.now() - (this.options.dictionaryRetentionMs ?? 30 * 24 * 60 * 60 * 1_000));
      const assets = await this.repository.listSpeechAssetsForCleanup(staleDictionaryBefore, this.options.batchSize ?? 100);
      for (const asset of assets) {
        try {
          if (!await this.repository.claimSpeechAssetCleanup(asset.id, staleDictionaryBefore)) continue;
          await this.storage.deleteObject(asset.objectKey);
          await this.repository.deleteSpeechAsset(asset.id, staleDictionaryBefore);
          deletedRows += 1;
        } catch (error) {
          failedRows += 1;
          console.error("[card-speech-cleanup] asset cleanup failed", asset.id, error);
        }
      }
    } catch (error) {
      roundFailed = true;
      console.error("[card-speech-cleanup] round failed", error);
    } finally {
      await this.writeRoundLog({ startedAt, deletedRows, failedRows, roundFailed });
      this.running = false;
    }
  }

  private async writeRoundLog(input: { startedAt: number; deletedRows: number; failedRows: number; roundFailed: boolean }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: "card",
        event: "card.worker.card_speech_cleanup_round",
        level: input.roundFailed ? "error" : input.failedRows ? "warn" : "info",
        status: input.roundFailed ? "failed" : "success",
        metadata: {
          worker: "card_speech_cleanup",
          status: input.roundFailed ? "failed" : input.failedRows ? "success_partial" : input.deletedRows ? "success" : "success_empty",
          durationMs: Date.now() - input.startedAt,
          deletedRows: input.deletedRows,
          failedRows: input.failedRows,
          batchSize: this.options.batchSize ?? 100,
        },
      });
    } catch (error) {
      console.error("[card-speech-cleanup] write round log failed", error);
    }
  }
}
