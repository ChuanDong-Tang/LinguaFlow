import assert from "node:assert/strict";
import test from "node:test";
import { exifCaptureTime, libraryCaptureTime } from "./photoCaptureTime";

test("reads EXIF original time with its offset", () => {
  assert.equal(exifCaptureTime({ DateTimeOriginal: "2026:11:08 14:23:11", OffsetTimeOriginal: "+08:00" }), "2026-11-08T06:23:11.000Z");
});

test("reads EXIF time without offset as device-local", () => {
  assert.equal(exifCaptureTime({ DateTimeOriginal: "2026:11:08 14:23:11" }), new Date(2026, 10, 8, 14, 23, 11).toISOString());
});

test("ignores missing, malformed and implausible EXIF dates", () => {
  assert.equal(exifCaptureTime(null), null);
  assert.equal(exifCaptureTime({ DateTimeOriginal: "0000:00:00 00:00:00" }), null);
  assert.equal(exifCaptureTime({ DateTimeOriginal: "garbage" }), null);
  assert.equal(exifCaptureTime({ DateTimeOriginal: "2999:01:01 00:00:00" }), null);
});

test("library timestamps: zero means unknown", () => {
  assert.equal(libraryCaptureTime(0), null);
  assert.equal(libraryCaptureTime(Date.UTC(2026, 10, 8)), "2026-11-08T00:00:00.000Z");
});
