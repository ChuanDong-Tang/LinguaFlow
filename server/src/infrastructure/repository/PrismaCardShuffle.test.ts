import test from "node:test";
import assert from "node:assert/strict";
import { PrismaCardRepository } from "./PrismaCardRepository.js";
import { CardService } from "../../services/card/CardService.js";

test("old clients retain chronological repository paging without raw SQL", async () => {
  let query: any;
  const repository = new PrismaCardRepository({ card: { findMany: async (args: unknown) => { query = args; return []; } } } as never);
  const createdAt = new Date("2026-10-01T00:00:00Z");
  await repository.listPageByUser({ userId: "old-client", collectionId: undefined, limit: 41, cursor: { createdAt, id: "last" } });
  assert.deepEqual(query.orderBy, [{ recordedAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(query.where.OR, [{ recordedAt: { lt: createdAt } }, { recordedAt: createdAt, id: { lt: "last" } }]);
  assert.equal(query.take, 41);
});

test("old v1 cursor remains accepted; random cursor rejects another round", async () => {
  let seen: any;
  const service = new CardService({ listPageByUser: async (input: unknown) => { seen = input; return []; } } as never, {} as never, {} as never, {} as never, 1000);
  const cursor = (seed?: string) => Buffer.from(JSON.stringify({ v: 1, createdAt: "2026-10-01T00:00:00Z", id: "last", shuffleSeed: seed })).toString("base64url");
  await service.listLibraryPage("user", { collectionId: undefined, cursor: cursor() });
  assert.equal(seen.shuffleSeed, undefined);
  await service.listLibraryPage("user", { collectionId: undefined, cursor: cursor("round-a"), shuffleSeed: "round-a" });
  assert.equal(seen.shuffleSeed, "round-a");
  await assert.rejects(service.listLibraryPage("user", { collectionId: undefined, cursor: cursor("round-a"), shuffleSeed: "round-b" }), /different shuffle round/);
  await assert.rejects(service.listLibraryPage("user", { collectionId: undefined, shuffleSeed: "bad seed!" }), /Invalid shuffle seed/);
});

test("shuffle query binds user, seed, descendant filter and cursor without fetching full content pool", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    cardCollection: { findMany: async () => [{ id: "parent", parentId: null }, { id: "child", parentId: "parent" }] },
    card: { findMany: async (args: any) => { assert.deepEqual(args.where.id.in, []); assert.equal(args.where.userId, "user-a"); return []; } },
    $queryRawUnsafe: async (sql: string, ...values: unknown[]) => { calls.push({ sql, values }); return []; },
  };
  const repository = new PrismaCardRepository(client as never);
  await repository.listPageByUser({ userId: "user-a", collectionId: "parent", shuffleSeed: "round-a", limit: 41, cursor: { id: "last-card", createdAt: new Date() } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ORDER BY md5\(\$2 \|\| id\), id LIMIT \$9/);
  assert.ok(!calls[0].sql.includes("user-a"));
  assert.deepEqual(calls[0].values, ["user-a", "round-a", false, false, ["parent", "child"], null, null, "last-card", 41, false, null]);
});

test("unclassified/date scope is preserved in random paging", async () => {
  let values: unknown[] = [];
  const repository = new PrismaCardRepository({
    card: { findMany: async () => [] },
    $queryRawUnsafe: async (_sql: string, ...parameters: unknown[]) => { values = parameters; return []; },
  } as never);
  await repository.listPageByUser({ userId: "user-b", collectionId: null, dateKey: "2026-10-24", shuffleSeed: "round-b", limit: 6 });
  assert.deepEqual(values, ["user-b", "round-b", false, true, null, "2026-10-24", null, null, 6, false, null]);
});
