import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryPhotoPager, type PhotoPage } from "./memoryPhotoPager";

type Photo = { id: string };
function page(id: string, cursor = id): PhotoPage<Photo> {
  return { assets: [{ id }], access: "all", canAskAgain: true, hasNextPage: true, endCursor: cursor };
}
function deferred() {
  let resolve!: (value: PhotoPage<Photo>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<PhotoPage<Photo>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("date switch ignores late pages and old request errors", async () => {
  const old = deferred();
  const fresh = deferred();
  let calls = 0;
  const pager = createMemoryPhotoPager(() => (++calls === 1 ? old.promise : fresh.promise), () => {});
  const first = pager.reset(new Date(2026, 9, 21));
  const second = pager.reset(new Date(2026, 9, 22));
  fresh.resolve(page("today"));
  await second;
  old.reject(new Error("late failure"));
  await first;
  assert.deepEqual(pager.getState().assets, [{ id: "today" }]);
  assert.equal(pager.getState().error, false);
});

test("duplicate loads coalesce and failures preserve cursor for retry", async () => {
  let calls = 0;
  const pending = deferred();
  const cursors: (string | undefined)[] = [];
  const pager = createMemoryPhotoPager(async (query) => {
    cursors.push(query.after);
    calls += 1;
    if (calls === 1) return pending.promise;
    if (calls === 2) throw new Error("read failed");
    return page("b");
  }, () => {});
  const first = pager.reset();
  await pager.loadMore();
  assert.equal(calls, 1);
  pending.resolve(page("a"));
  await first;
  await pager.loadMore();
  assert.equal(pager.getState().error, true);
  await pager.loadMore();
  assert.deepEqual(cursors, [undefined, "a", "a"]);
  assert.deepEqual(pager.getState().assets.map((photo) => photo.id), ["a", "b"]);
});

test("revoked permission clears photos; limited scope restarts from first page", async () => {
  const queries: (string | undefined)[] = [];
  const pages = [page("a"), { ...page("stale"), access: "limited" as const }, { ...page("allowed"), access: "limited" as const }, { ...page("forbidden"), access: "denied" as const }];
  const pager = createMemoryPhotoPager(async (query) => { queries.push(query.after); return pages.shift()!; }, () => {});
  await pager.reset();
  await pager.loadMore();
  assert.deepEqual(queries, [undefined, "a", undefined]);
  assert.deepEqual(pager.getState().assets, [{ id: "allowed" }]);
  await pager.loadMore();
  assert.deepEqual(pager.getState().assets, []);
  assert.equal(pager.getState().hasNextPage, false);
});

test("dispose ignores late results and repeated cursor stops pagination", async () => {
  const request = deferred();
  let notifications = 0;
  const pager = createMemoryPhotoPager(() => request.promise, () => { notifications += 1; });
  const work = pager.reset();
  pager.dispose();
  const before = notifications;
  request.resolve(page("a"));
  await work;
  assert.equal(notifications, before);
  const repeated = createMemoryPhotoPager(async () => page("a"), () => {});
  await repeated.reset();
  await repeated.loadMore();
  assert.equal(repeated.getState().hasNextPage, false);
  assert.deepEqual(repeated.getState().assets, [{ id: "a" }]);
});

test("late successful page cannot restore photos after permission revocation", async () => {
  const old = deferred();
  let calls = 0;
  const pager = createMemoryPhotoPager(async () => {
    calls++;
    return calls === 1 ? old.promise : { ...page("not-allowed"), access: "denied" as const };
  }, () => {});
  const first = pager.reset();
  await pager.reset();
  old.resolve(page("formerly-readable"));
  await first;
  assert.equal(pager.getState().access, "denied");
  assert.deepEqual(pager.getState().assets, []);
  assert.equal(pager.getState().hasNextPage, false);
});

test("date argument is copied and empty boundary pages retain pagination", async () => {
  const date = new Date(2026, 9, 22);
  const original = date.getTime();
  const queries: { day?: Date; after?: string }[] = [];
  const pager = createMemoryPhotoPager(async query => {
    queries.push(query);
    return queries.length === 1 ? { ...page("boundary"), assets: [] } : page("inside-day");
  }, () => {});
  await pager.reset(date);
  date.setDate(23);
  await pager.loadMore();
  assert.equal(queries[1]?.day?.getTime(), original);
  assert.equal(queries[1]?.after, "boundary");
  assert.deepEqual(pager.getState().assets, [{ id: "inside-day" }]);
});
