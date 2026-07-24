import type { CardWorkerConcurrencyGuard } from "./CardWorkerConcurrencyGuard.js";

type SerialCardJobService = {
  claimAndProcess(workerId: string): Promise<boolean>;
};

export class SerialCardJobWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly workerId: string;

  constructor(
    private readonly service: SerialCardJobService,
    private readonly options: {
      workerIdPrefix: string;
      errorLabel: string;
      intervalMs?: number;
      concurrencyGuard?: CardWorkerConcurrencyGuard;
      concurrencyScope?: string;
      concurrencyLimit?: number;
    },
  ) {
    this.workerId = `${options.workerIdPrefix}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs ?? 1_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (await this.claimAndProcess()) {
        // Drain serially; deploy more worker processes for controlled concurrency.
      }
    } catch (error) {
      console.error(`[${this.options.errorLabel}] round failed`, error);
    } finally {
      this.running = false;
    }
  }

  private async claimAndProcess(): Promise<boolean> {
    const guard = this.options.concurrencyGuard;
    const scope = this.options.concurrencyScope;
    const limit = this.options.concurrencyLimit;
    if (!guard || !scope || !limit) return this.service.claimAndProcess(this.workerId);
    const result = await guard.runWithLease(
      scope,
      limit,
      () => this.service.claimAndProcess(this.workerId),
    );
    return result.acquired ? result.value : false;
  }
}
