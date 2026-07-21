import type { JournalRewriteWorkerService } from "../../services/journal/JournalRewriteWorkerService.js";

export class JournalRewriteWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCleanupAt = 0;
  private readonly workerId = `journal-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

  constructor(
    private readonly service: JournalRewriteWorkerService,
    private readonly options: { intervalMs?: number; idleIntervalMs?: number } = {},
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.options.intervalMs ?? 1_000;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.service.failExpiredLeases();
      if (Date.now() - this.lastCleanupAt >= 60 * 60 * 1_000) {
        await this.service.cleanupExpiredFailureTombstones();
        this.lastCleanupAt = Date.now();
      }
      while (await this.service.claimAndProcess(this.workerId)) {
        // Drain queued work serially; global provider concurrency comes from multiple worker instances.
      }
    } catch (error) {
      console.error("[journal-rewrite-worker] round failed", error);
    } finally {
      this.running = false;
    }
  }
}
