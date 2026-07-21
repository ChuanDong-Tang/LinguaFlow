import type { JournalRepository } from "@lf/core/ports/repository/JournalRepository.js";
import type { TtsStorageProvider } from "../../services/tts/TtsStorageProvider.js";

export class JournalSpeechCleanupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: JournalRepository,
    private readonly storage: TtsStorageProvider,
    private readonly options: { intervalMs?: number; batchSize?: number; dictionaryRetentionMs?: number } = {},
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
    try {
      const staleDictionaryBefore = new Date(Date.now() - (this.options.dictionaryRetentionMs ?? 30 * 24 * 60 * 60 * 1_000));
      const assets = await this.repository.listSpeechAssetsForCleanup(staleDictionaryBefore, this.options.batchSize ?? 100);
      for (const asset of assets) {
        try {
          if (!await this.repository.claimSpeechAssetCleanup(asset.id, staleDictionaryBefore)) continue;
          await this.storage.deleteObject(asset.objectKey);
          await this.repository.deleteSpeechAsset(asset.id, staleDictionaryBefore);
        } catch (error) {
          console.error("[journal-speech-cleanup] asset cleanup failed", asset.id, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
