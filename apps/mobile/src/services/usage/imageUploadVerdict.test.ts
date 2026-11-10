import assert from "node:assert/strict";
import test from "node:test";
import { imageUploadVerdict } from "./imageUploadVerdict";

const images = (over: Record<string, unknown> = {}) => ({
  periodStart: "", periodEnd: "", quotaBytes: "1000", uploadedBytes: "0", reservedUploadBytes: "0",
  remainingUploadBytes: "1000", capacityBytes: "1000", usedBytes: "0", reservedBytes: "0", remainingBytes: "1000",
  dailyUploadLimit: 20, dailyUploadsUsed: 0, ...over,
});

test("a batch that fits is allowed", () => {
  assert.equal(imageUploadVerdict(images(), { count: 3, bytes: 900 }), "ok");
});

test("the whole batch is refused when it would pass today's count", () => {
  assert.equal(imageUploadVerdict(images({ dailyUploadsUsed: 18 }), { count: 3, bytes: 10 }), "image_daily");
  assert.equal(imageUploadVerdict(images({ dailyUploadsUsed: 17 }), { count: 3, bytes: 10 }), "ok");
});

test("refused when the bytes exceed what is left this period", () => {
  assert.equal(imageUploadVerdict(images({ remainingUploadBytes: "500" }), { count: 1, bytes: 501 }), "image");
});

test("older servers without a daily count only check bytes", () => {
  assert.equal(imageUploadVerdict(images({ dailyUploadsUsed: undefined }), { count: 99, bytes: 1 }), "ok");
});
