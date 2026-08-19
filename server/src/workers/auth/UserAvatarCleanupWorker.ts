import type { UserProfileRepository } from "@lf/core/ports/repository/UserProfileRepository.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { CardImageStorageProvider } from "../../providers/storage/CardImageStorageProvider.js";

export class UserAvatarCleanupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly repository: UserProfileRepository,
    private readonly storage: CardImageStorageProvider,
    private readonly options: { intervalMs?: number; batchSize?: number } = {},
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
          deletedRows += 1;
        } catch (error) {
          failedRows += 1;
          console.error("[user-avatar-cleanup] asset cleanup failed", asset.id, error);
        }
      }
      const uploadObjects = await this.repository.listAvatarUploadObjectsForCleanup(this.options.batchSize ?? 100);
      for (const asset of uploadObjects) {
        if (!asset.uploadObjectKey) continue;
        try {
          await this.storage.delete(asset.uploadObjectKey);
          await this.repository.clearAvatarUploadObjectKey(asset.id, asset.uploadObjectKey);
          deletedRows += 1;
        } catch (error) {
          failedRows += 1;
          console.error("[user-avatar-cleanup] isolated upload cleanup failed", asset.id, error);
        }
      }
    } catch (error) {
      roundFailed = true;
      console.error("[user-avatar-cleanup] round failed", error);
    } finally {
      await this.writeRoundLog({ startedAt, deletedRows, failedRows, roundFailed });
      this.running = false;
    }
  }

  private async writeRoundLog(input: { startedAt: number; deletedRows: number; failedRows: number; roundFailed: boolean }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: "auth",
        event: "auth.worker.user_avatar_cleanup_round",
        level: input.roundFailed ? "error" : input.failedRows ? "warn" : "info",
        status: input.roundFailed ? "failed" : "success",
        metadata: {
          worker: "user_avatar_cleanup",
          status: input.roundFailed ? "failed" : input.failedRows ? "success_partial" : input.deletedRows ? "success" : "success_empty",
          durationMs: Date.now() - input.startedAt,
          deletedRows: input.deletedRows,
          failedRows: input.failedRows,
          batchSize: this.options.batchSize ?? 100,
        },
      });
    } catch (error) {
      console.error("[user-avatar-cleanup] write round log failed", error);
    }
  }
}
