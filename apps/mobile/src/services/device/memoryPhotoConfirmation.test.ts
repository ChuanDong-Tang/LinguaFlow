import test from "node:test";
import assert from "node:assert/strict";
import { confirmAccessiblePhoto } from "./memoryPhotoConfirmation";

test("revoked permission never reaches photo upload", async () => {
  let uploads = 0;
  await assert.rejects(confirmAccessiblePhoto(async () => false, () => true, async () => { uploads++; }));
  assert.equal(uploads, 0);
});

test("selection invalidated during access check never reaches upload", async () => {
  let current = true;
  let uploads = 0;
  await assert.rejects(confirmAccessiblePhoto(async () => { current = false; return true; }, () => current, async () => { uploads++; }));
  assert.equal(uploads, 0);
});

test("native access failure stops confirmation and can be retried", async () => {
  let uploads = 0;
  const upload = async () => { uploads++; };
  await assert.rejects(confirmAccessiblePhoto(async () => { throw new Error("unavailable"); }, () => true, upload));
  assert.equal(uploads, 0);
  await confirmAccessiblePhoto(async () => true, () => true, upload);
  assert.equal(uploads, 1);
});

test("already closed selection does not even read photo metadata", async () => {
  let reads = 0;
  await assert.rejects(confirmAccessiblePhoto(async () => { reads++; return true; }, () => false, async () => {}));
  assert.equal(reads, 0);
});

test("confirmation failure is propagated, never silently retried", async () => {
  let attempts = 0;
  const failure = new Error("upload unavailable");
  await assert.rejects(confirmAccessiblePhoto(async () => true, () => true, async () => {
    attempts++;
    throw failure;
  }), error => error === failure);
  assert.equal(attempts, 1);
});

test("closing while native verification is pending prevents confirmation", async () => {
  let finish!: (allowed: boolean) => void;
  let current = true;
  let confirmations = 0;
  const pending = new Promise<boolean>(resolve => { finish = resolve; });
  const work = confirmAccessiblePhoto(() => pending, () => current, async () => { confirmations++; });
  const rejected = assert.rejects(work);
  current = false;
  finish(true);
  await rejected;
  assert.equal(confirmations, 0);
});
