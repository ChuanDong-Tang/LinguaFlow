/** WeChatAutoRenewBillingWorker：扫描到期自动续费协议，并主动向微信发起本期扣款。 */

import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { AutoRenewService } from "../../services/payment/AutoRenewService.js";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import { getRedisClient } from "../../infrastructure/redis/redisClient.js";

export class WeChatAutoRenewBillingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly autoRenewService: AutoRenewService,
    private readonly systemEventLogRepository?: SystemEventLogRepository
  ) {}

  start(): void {
    if (this.timer) return;
    const runtime = getRuntimeConfig();
    if (!runtime.payment.wechatAutoRenew.enabled) return;

    // 启动先跑一次，避免进程刚启动时错过已到期扣款。
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, runtime.payment.wechatAutoRenew.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const lockValue = `${process.pid}:${Date.now()}`;
    try {
      const runtime = getRuntimeConfig();
      const redis = getRedisClient();
      if (redis) {
        // 多实例部署时只允许一个 worker 扫描自动续费，避免同一周期被并发扣款。
        const locked = await (redis.set as any)(
          "lock:wechat_autorenew_billing:run",
          lockValue,
          "NX",
          "PX",
          Math.max(runtime.payment.wechatAutoRenew.intervalMs - 1000, 30_000)
        );
        if (locked !== "OK") return;
      }
      const result = await this.autoRenewService.runDueWeChatBilling({
        limit: runtime.payment.wechatAutoRenew.batchSize,
      });
      console.log("[wechat-autorenew-billing]", result);
    } catch (error) {
      console.error("[wechat-autorenew-billing] failed", error);
      await this.writeWorkerLog({
        event: "payment.autorenew.wechat.worker_failed",
        errorCode: "WECHAT_AUTORENEW_WORKER_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await this.releaseLock(lockValue);
      this.running = false;
    }
  }

  private async releaseLock(lockValue: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.eval(
      `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
      `,
      1,
      "lock:wechat_autorenew_billing:run",
      lockValue
    );
  }

  private async writeWorkerLog(input: {
    event: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    if (!this.systemEventLogRepository) return;
    try {
      await this.systemEventLogRepository.create({
        module: "payment",
        event: input.event,
        level: "error",
        status: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      });
    } catch (error) {
      console.error("[wechat-autorenew-billing] write system_event_log failed", error);
    }
  }
}
