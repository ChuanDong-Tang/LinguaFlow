import assert from "node:assert/strict";
import test from "node:test";
import type { RedisClient } from "../../infrastructure/redis/redisClient.js";
import { TtsStreamingCoordinator } from "./TtsStreamingCoordinator.js";

const coordinator = new TtsStreamingCoordinator({} as RedisClient, { ticketSecret: "test-secret-that-is-not-used-in-production" });

test("stream ticket round-trips its bound generation", () => {
  const ticket = coordinator.createTicket({ generationId: "generation-1", cacheKey: "cache-1", userId: "user-1" });
  assert.deepEqual(coordinator.verifyTicket(ticket), {
    generationId: "generation-1",
    cacheKey: "cache-1",
    userId: "user-1",
    expiresAt: coordinator.verifyTicket(ticket)!.expiresAt,
  });
});

test("stream ticket rejects tampering and expiration", () => {
  const ticket = coordinator.createTicket({ generationId: "generation-1", cacheKey: "cache-1", userId: "user-1" });
  assert.equal(coordinator.verifyTicket(`${ticket}x`), null);
  const expired = coordinator.createTicket({ generationId: "generation-1", cacheKey: "cache-1", userId: "user-1" }, -1);
  assert.equal(coordinator.verifyTicket(expired), null);
});
