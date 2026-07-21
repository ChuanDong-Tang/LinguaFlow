import type { JournalRepository } from "@lf/core/ports/repository/JournalRepository.js";
import type { JournalImageStorageProvider } from "../../providers/storage/JournalImageStorageProvider.js";

export class JournalImageCleanupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(
    private readonly repository: JournalRepository,
    private readonly storage: JournalImageStorageProvider,
    private readonly options: { intervalMs?: number; batchSize?: number } = {},
  ) {}
  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 60 * 60 * 1_000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const assets = await this.repository.listImageAssetsForCleanup(new Date(), this.options.batchSize ?? 100);
      for (const asset of assets) {
        try {
          const extension = asset.mimeType === "image/png" ? "png" : "jpg";
          const promotedKey = `journal-assets/${asset.userId}/${asset.id}/original.${extension}`;
          const keys = new Set([
            asset.originalObjectKey,
            ...(asset.uploadObjectKey ? [asset.uploadObjectKey] : []),
            promotedKey,
            ...(asset.thumbnailObjectKey ? [asset.thumbnailObjectKey] : []),
            `journal-assets/${asset.userId}/${asset.id}/thumbnail-v1.jpg`,
          ]);
          const deleted = await Promise.allSettled([...keys].map((key) => this.storage.delete(key)));
          const failed = deleted.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          await this.repository.deleteUnclaimedImageAsset(asset.id);
        } catch (error) {
          console.error("[journal-image-cleanup] asset cleanup failed", asset.id, error);
        }
      }
      const uploadObjects = await this.repository.listImageUploadObjectsForCleanup(this.options.batchSize ?? 100);
      for (const asset of uploadObjects) {
        if (!asset.uploadObjectKey) continue;
        try {
          await this.storage.delete(asset.uploadObjectKey);
          await this.repository.clearImageUploadObjectKey(asset.id, asset.uploadObjectKey);
        } catch (error) {
          console.error("[journal-image-cleanup] isolated upload cleanup failed", asset.id, error);
        }
      }
    } finally { this.running = false; }
  }
}
