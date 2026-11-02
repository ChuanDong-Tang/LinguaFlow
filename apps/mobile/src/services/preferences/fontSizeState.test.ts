import assert from "node:assert/strict";
import test from "node:test";
import { createFontSizeStore, FONT_SIZE_KEY, FONT_SCALES, normalizeFontSize, scaledFontMetrics } from "./fontSizeState";

test("font preference defaults safely and uses three bounded sizes", async () => {
  for (const raw of [null, "", "broken", "medium", "42"]) {
    const store = createFontSizeStore({ getItem: async () => raw, setItem: async () => {} });
    await store.load();
    assert.equal(store.getSnapshot(), "medium");
  }
  assert.equal(normalizeFontSize({}), "medium");
  assert.deepEqual(FONT_SCALES, { small: .9, medium: 1, large: 1.15 });
});

test("saved device choice survives a fresh store without any user identity", async () => {
  const data = new Map<string, string>();
  const storage = { getItem: async (key: string) => data.get(key) ?? null, setItem: async (key: string, value: string) => { data.set(key, value); } };
  const store = createFontSizeStore(storage);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const saving = store.set("large");
  assert.equal(store.getSnapshot(), "large");
  await saving;
  unsubscribe();
  assert.equal(notifications, 1);
  assert.deepEqual([...data.keys()], [FONT_SIZE_KEY]);
  const restarted = createFontSizeStore(storage);
  await restarted.load();
  assert.equal(restarted.getSnapshot(), "large");
});

test("late hydration cannot override a newer user selection", async () => {
  let resolve!: (value: string) => void;
  const store = createFontSizeStore({ getItem: () => new Promise<string>(done => { resolve = done; }), setItem: async () => {} });
  const loading = store.load();
  await store.set("small");
  resolve("large");
  await loading;
  assert.equal(store.getSnapshot(), "small");
});

test("storage failures recover and ordered writes retain latest choice", async () => {
  let saved = "medium";
  const writes: string[] = [];
  const store = createFontSizeStore({
    getItem: async () => { throw Error("read failed"); },
    setItem: async (_, value) => { writes.push(value); if (value === "small") throw Error("full"); saved = value; },
  });
  await store.load();
  assert.equal(store.getSnapshot(), "medium");
  await store.set("large");
  await assert.rejects(store.set("small"));
  assert.equal(store.getSnapshot(), "large");
  const failed = assert.rejects(store.set("small"));
  const latest = store.set("medium");
  await Promise.all([failed, latest]);
  assert.equal(store.getSnapshot(), "medium");
  assert.equal(saved, "medium");
  assert.deepEqual(writes, ["large", "small", "small", "medium"]);
});

test("scale only explicit nested metrics, preserve medium and source styles", () => {
  const style = { fontSize: 20, lineHeight: 30, letterSpacing: 1 };
  assert.deepEqual(scaledFontMetrics(style, 1), {});
  assert.deepEqual(scaledFontMetrics(style, .9), { fontSize: 18, lineHeight: 27, letterSpacing: .9 });
  assert.deepEqual(scaledFontMetrics({}, 1.15, true), {});
  assert.deepEqual(scaledFontMetrics({ fontSize: 20 }, 1.15, true), { fontSize: 23 });
  assert.deepEqual(style, { fontSize: 20, lineHeight: 30, letterSpacing: 1 });
});
