import assert from "node:assert/strict";
import test from "node:test";
import { memoryPhotoAccess, photoDayRange, mergePhotoPage, photoBatch, nextPhotoSet, memoryPhotoPreviewUri } from "./memoryPhotoPolicy";

test("photo previews resolve local files without passing Photos IDs or cloud URLs to Image", () => {
  assert.equal(memoryPhotoPreviewUri({ uri: "ph://asset", localUri: "file:///photo.jpg" }), "file:///photo.jpg");
  assert.equal(memoryPhotoPreviewUri({ uri: "ph://cloud-only" }), null);
  assert.equal(memoryPhotoPreviewUri({ uri: "content://media/1" }), "content://media/1");
  assert.equal(memoryPhotoPreviewUri({ uri: "file:///android.jpg" }), "file:///android.jpg");
  assert.equal(memoryPhotoPreviewUri({ uri: "https://example.test/photo.jpg" }), null);
});

test("limited photo access is usable without treating denied access as full", () => {
  assert.equal(memoryPhotoAccess({ granted: false, status: "granted", accessPrivileges: "limited" }), "limited");
  assert.equal(memoryPhotoAccess({ granted: true, status: "granted", accessPrivileges: "none" }), "denied");
  assert.equal(memoryPhotoAccess({ granted: true, status: "granted" }), "all");
  assert.equal(memoryPhotoAccess({ granted: false, status: "undetermined" }), "undetermined");
  assert.equal(memoryPhotoAccess({ granted: false, status: "denied" }), "denied");
});

test("photo day spans local midnight through next local midnight", () => {
  const range = photoDayRange(new Date(2026, 9, 31, 21, 30));
  assert.equal(range.start, new Date(2026, 9, 31).getTime());
  assert.equal(range.end, new Date(2026, 10, 1).getTime());
  assert.throws(() => photoDayRange(new Date(NaN)));
});

test("pages deduplicate without reordering the current deck", () => {
  const first = [{ id: "a" }];
  assert.deepEqual(mergePhotoPage(first, [{ id: "a" }, { id: "b" }, { id: "b" }]), [{ id: "a" }, { id: "b" }]);
  assert.equal(first.length, 1);
});

test("random batches are bounded, unique and do not mutate the photo pool", () => {
  const source = [1, 2, 3, 4];
  assert.deepEqual(photoBatch(source, 2, () => 0.99), [4, 1]);
  assert.equal(new Set(photoBatch(source, 99)).size, 4);
  assert.deepEqual(photoBatch(source, NaN), []);
  assert.deepEqual(photoBatch([], 15), []);
  assert.deepEqual(source, [1, 2, 3, 4]);
});

test("next photo set loads beyond the current page before wrapping", () => {
  const photos = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(nextPhotoSet(photos, photos.slice(0, 2), 2, false, true), { assets: photos.slice(2), needsMore: false });
  assert.deepEqual(nextPhotoSet(photos, photos.slice(2), 2, false, true), { assets: [], needsMore: true });
  assert.deepEqual(nextPhotoSet(photos, photos.slice(2), 2, false, false), { assets: photos.slice(0, 2), needsMore: false });
  assert.deepEqual(nextPhotoSet(photos, photos.slice(0, 2), 2, true, false, () => 0).assets, photos.slice(2));
  assert.deepEqual(nextPhotoSet([], [], 15, false, false), { assets: [], needsMore: false });
});
