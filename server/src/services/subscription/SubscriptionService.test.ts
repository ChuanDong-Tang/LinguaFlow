import assert from "node:assert/strict";
import test from "node:test";
import type {
  CreateSubscriptionInput,
  SubscriptionEntity,
  SubscriptionRepository,
} from "@lf/core/ports/repository/SubscriptionRepository.js";
import { SubscriptionService } from "./SubscriptionService.js";

test("syncing the same Google charge extends an existing entitlement", async () => {
  const repository = new MemorySubscriptionRepository();
  const service = new SubscriptionService(repository);
  const firstEnd = new Date("2026-08-01T00:00:00.000Z");
  const deferredEnd = new Date("2026-08-08T00:00:00.000Z");

  await service.openOrRenewMembership({
    userId: "user-1",
    plan: "pro_monthly",
    sourceOrderId: "google_play_iap:GPA.1",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: firstEnd,
    now: new Date("2026-07-01T00:00:00.000Z"),
  });
  const synced = await service.openOrRenewMembership({
    userId: "user-1",
    plan: "pro_monthly",
    sourceOrderId: "google_play_iap:GPA.1",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: deferredEnd,
    now: new Date("2026-07-20T00:00:00.000Z"),
  });

  assert.equal(synced.alreadyApplied, false);
  assert.equal(synced.subscription.expiresAt.toISOString(), deferredEnd.toISOString());
});

test("recovery reactivates an entitlement suspended during account hold", async () => {
  const repository = new MemorySubscriptionRepository();
  const service = new SubscriptionService(repository);
  const sourceOrderId = "google_play_iap:GPA.2";
  await service.openOrRenewMembership({
    userId: "user-1",
    plan: "plus_monthly",
    sourceOrderId,
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-08-01T00:00:00.000Z"),
    now: new Date("2026-07-01T00:00:00.000Z"),
  });
  await repository.cancelActiveBySourceOrderId({
    sourceOrderId,
    cancelledAt: new Date("2026-07-15T00:00:00.000Z"),
    expiresAt: new Date("2026-07-15T00:00:00.000Z"),
  });

  const recovered = await service.openOrRenewMembership({
    userId: "user-1",
    plan: "plus_monthly",
    sourceOrderId,
    periodStart: new Date("2026-07-20T00:00:00.000Z"),
    periodEnd: new Date("2026-08-20T00:00:00.000Z"),
    now: new Date("2026-07-20T00:00:00.000Z"),
  });

  assert.equal(recovered.alreadyApplied, false);
  assert.equal(recovered.subscription.status, "active");
  assert.equal(recovered.subscription.expiresAt.toISOString(), "2026-08-20T00:00:00.000Z");
});

class MemorySubscriptionRepository implements SubscriptionRepository {
  private rows: SubscriptionEntity[] = [];

  async findCurrentActiveByUserId(userId: string, now: Date): Promise<SubscriptionEntity | null> {
    return this.rows.find((row) => row.userId === userId && row.status === "active" && row.expiresAt > now) ?? null;
  }

  async findBySourceOrderId(sourceOrderId: string): Promise<SubscriptionEntity | null> {
    return this.rows.find((row) => row.sourceOrderId === sourceOrderId) ?? null;
  }

  async cancelActiveBySourceOrderId(input: {
    sourceOrderId: string;
    cancelledAt: Date;
    expiresAt: Date;
  }): Promise<SubscriptionEntity | null> {
    const row = await this.findBySourceOrderId(input.sourceOrderId);
    if (!row || row.status !== "active") return null;
    row.status = "cancelled";
    row.expiresAt = input.expiresAt;
    return row;
  }

  async syncPeriodBySourceOrderId(input: {
    sourceOrderId: string;
    plan: "plus_monthly" | "pro_monthly";
    startedAt: Date;
    expiresAt: Date;
  }): Promise<SubscriptionEntity | null> {
    const row = await this.findBySourceOrderId(input.sourceOrderId);
    if (!row) return null;
    row.plan = input.plan;
    row.status = "active";
    if (input.startedAt < row.startedAt) row.startedAt = input.startedAt;
    if (input.expiresAt > row.expiresAt) row.expiresAt = input.expiresAt;
    return row;
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionEntity> {
    const now = new Date();
    const row: SubscriptionEntity = {
      id: `subscription-${this.rows.length + 1}`,
      userId: input.userId,
      plan: input.plan,
      status: input.status,
      startedAt: input.startedAt,
      expiresAt: input.expiresAt,
      sourceOrderId: input.sourceOrderId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }
}
