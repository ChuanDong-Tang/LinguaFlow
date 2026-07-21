import type { UserProfileRepository } from "@lf/core/ports/repository/UserProfileRepository.js";
import type { JournalImageStorageProvider } from "../../providers/storage/JournalImageStorageProvider.js";

export class UserAvatarCleanupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: UserProfileRepository,
    private readonly storage: JournalImageStorageProvider,
    private readonly options: { intervalMs?: number; batchSize?: number } = {},
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
      const assets = await this.repository.listAvatarAssetsForCleanup(new Date(), this.options.batchSize ?? 100);
      for (const asset of assets) {
        try {
          await Promise.all([
            this.storage.delete(asset.originalObjectKey),
            ...(asset.uploadObjectKey ? [this.storage.delete(asset.uploadObjectKey)] : []),
            ...(asset.profileObjectKey ? [this.storage.delete(asset.profileObjectKey)] : []),
            ...(asset.thumbnailObjectKey ? [this.storage.delete(asset.thumbnailObjectKey)] : []),
          ]);
          await this.repository.deleteUnusedAvatarAsset(asset.id);
        } catch (error) {
          console.error("[user-avatar-cleanup] asset cleanup failed", asset.id, error);
        }
      }
      const uploadObjects = await this.repository.listAvatarUploadObjectsForCleanup(this.options.batchSize ?? 100);
      for (const asset of uploadObjects) {
        if (!asset.uploadObjectKey) continue;
        try {
          await this.storage.delete(asset.uploadObjectKey);
          await this.repository.clearAvatarUploadObjectKey(asset.id, asset.uploadObjectKey);
        } catch (error) {
          console.error("[user-avatar-cleanup] isolated upload cleanup failed", asset.id, error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
